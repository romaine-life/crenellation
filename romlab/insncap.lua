-- Test one instruction at a time on the real 68000.
--
-- Routine-level differences say a routine is wrong, not which rule is wrong,
-- and the call graph spreads a single bad rule across hundreds of routines.
-- This assembles each distinct instruction encoding found in the ROM into
-- scratch memory on its own, runs it with known register state, and records
-- the result. A wrong rule then shows up as exactly itself.
local OUT = "D:/repos/crenellation/romlab/out/insn/"
local log = io.open(OUT .. "i.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}

local CODE = 0x3E6000          -- the instruction under test is written here
local PARK = 0x3E6100          -- branch-to-self, where the CPU comes to rest
local SCRATCH = 0x3E4000
local SCRATCH_LEN = 0x400
local STACK = 0x3E5000

local seed = 0x2468ACE0
local function rnd()
  seed = seed ~ ((seed << 13) & 0xFFFFFFFF)
  seed = seed & 0xFFFFFFFF
  seed = seed ~ (seed >> 17)
  seed = seed ~ ((seed << 5) & 0xFFFFFFFF)
  seed = seed & 0xFFFFFFFF
  return seed
end

-- encodings to test: hex byte strings, one per line
local cases = {}
do
  local f = io.open("D:/repos/crenellation/romlab/out/insn/encodings.txt", "r")
  for line in f:lines() do
    local hex = line:match("^(%x+)")
    if hex and #hex >= 4 then cases[#cases + 1] = hex end
  end
  f:close()
end

local idx, trial = 1, 0
local TRIALS = 2
local frame = 0
local running = false
local inregs = {}
local a6set = 0
local startedFrame = 0
local finished = false
local baseline = {}
local dirty = {}

-- Each case must start from the same memory. Without this, writes from earlier
-- instructions accumulate on the hardware side while the port starts clean, and
-- every instruction that reads memory disagrees for reasons unrelated to its
-- rule.
local function restore_ram()
  -- guard the lookup: marking the full write width can push an address past
  -- the baseline's end, and a nil there aborts the loop and leaves everything
  -- after it un-restored
  for addr in pairs(dirty) do
    local b = baseline[addr]
    if b ~= nil then space:write_u8(addr, b) end
  end
  dirty = {}
end

local function write_case(hex)
  for i = 0, #hex // 2 - 1 do
    space:write_u8(CODE + i, tonumber(hex:sub(i * 2 + 1, i * 2 + 2), 16))
  end
  -- fall straight into the park after the instruction
  space:write_u16(CODE + #hex // 2, 0x6000)
  space:write_u16(CODE + #hex // 2 + 2, PARK - (CODE + #hex // 2 + 2))
  space:write_u16(PARK, 0x60FE)
end

local function begin_case()
  if idx > #cases then
    if not finished then
      finished = true
      log:write("done " .. (idx - 1) .. NL); log:flush(); manager.machine:exit()
    end
    return
  end
  restore_ram()
  for i = 0, SCRATCH_LEN - 1 do space:write_u8(SCRATCH + i, rnd() % 256) end
  inregs = {}
  for k = 0, 7 do
    local v = rnd()
    inregs["D" .. k] = v
    cpu.state["D" .. k].value = v
  end
  for k = 0, 5 do
    local v = SCRATCH + (rnd() % (SCRATCH_LEN - 0x100))
    inregs["A" .. k] = v
    cpu.state["A" .. k].value = v
  end
  cpu.state["A6"].value = STACK + 0x200
  a6set = cpu.state["A6"].value
  cpu.state["SP"].value = STACK - 0x40
  cpu.state["SR"].value = 0x2700
  write_case(cases[idx])
  cpu.state["PC"].value = CODE
  running = true
  startedFrame = frame
end

local function record(ok)
  local ins = {}
  for k = 0, 7 do ins[#ins + 1] = string.format("%08X", inregs["D" .. k]) end
  for k = 0, 5 do ins[#ins + 1] = string.format("%08X", inregs["A" .. k]) end
  if ok then
    local outs = {}
    for k = 0, 7 do outs[#outs + 1] = string.format("%08X", cpu.state["D" .. k].value % 0x100000000) end
    for k = 0, 5 do outs[#outs + 1] = string.format("%08X", cpu.state["A" .. k].value % 0x100000000) end
    outs[#outs + 1] = string.format("%04X", cpu.state["SR"].value % 0x10000)
    -- a digest of scratch catches memory writes the instruction made
    local h = 0
    for i = 0, SCRATCH_LEN - 1 do h = (h * 31 + space:read_u8(SCRATCH + i)) & 0xFFFFFFFF end
    outs[#outs + 1] = string.format("%08X", h)
    log:write(string.format("I %s %d %s | %s | A6=%08X MEM=%04X", cases[idx], trial,
      table.concat(ins, " "), table.concat(outs, " "), a6set,
      space:read_u16(STACK + 0x200 - 2)) .. NL)
  else
    log:write(string.format("X %s %d", cases[idx], trial) .. NL)
  end
  trial = trial + 1
  if trial >= TRIALS then trial = 0; idx = idx + 1 end
end

local function install()
  TAPS[#TAPS + 1] = space:install_read_tap(PARK, PARK + 1, "park",
    function(o, d, mask)
      if running then running = false end
      return d
    end)
  TAPS[#TAPS + 1] = space:install_write_tap(0x3E0000, 0x3EFFFF, "w",
    function(offset, d, mask)
      -- a tap reports the base address of an access, so a word or long write
      -- dirties bytes beyond it; mark the whole width or the tail is never
      -- restored and leaks into later cases
      for i = 0, 3 do
        if dirty[offset + i] == nil then dirty[offset + i] = true end
      end
      return d
    end)
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 400 then
    -- dump work RAM so the port starts from the same memory. Without this any
    -- instruction reading outside the randomised scratch compares different
    -- bytes on the two sides.
    do
      local t = {}
      for a = 0x3E0000, 0x3EFFFF do
        local b = space:read_u8(a)
        baseline[a] = b
        t[#t + 1] = string.char(b)
      end
      local fh = io.open(OUT .. "ram-baseline.bin", "wb")
      fh:write(table.concat(t)); fh:close()
    end
    space:write_u16(PARK, 0x60FE)
    install()
    begin_case()
    return
  end
  if frame < 400 then return end
  if not running and not finished then
    record(true)
    begin_case()
  elseif running and frame > startedFrame + 1 then
    running = false
    record(false)
    begin_case()
  end
end)
