-- Differential capture: run every routine from randomised state and record it.
--
-- Hand-writing a test per routine does not scale to 593. Instead, put the real
-- 68000 into a known state, run one routine, and record what came out.
--
-- The whole of work RAM is dumped once as a baseline, because a routine can
-- read anywhere in it. The port loads the same baseline, so both sides start
-- from byte-identical memory - without that, a routine reading outside the
-- randomised window sees the running game on one side and zeroes on the other,
-- and every comparison is meaningless.
--
-- After each case, only the bytes the routine actually wrote are restored,
-- which keeps the baseline intact without copying 64KB per case.
local OUT = "D:/repos/crenellation/romlab/out/fuzz/"
local log = io.open(OUT .. "f.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}

local SENTINEL = 0x0FFFF0
local RAM_LO, RAM_HI = 0x3E0000, 0x3EFFFF
local SCRATCH = 0x3E4000
local SCRATCH_LEN = 0x400
local STACK = 0x3E5000
local DIGEST_LO, DIGEST_LEN = 0x3E4000, 0x2000   -- scratch plus the stack area

local REGS = { "D0","D1","D2","D3","D4","D5","D6","D7",
               "A0","A1","A2","A3","A4","A5","A6","SP","PC","SR" }

-- xorshift32: exact in Lua 5.4 integers and in JS with >>> 0, so the port can
-- regenerate byte-identical inputs without shipping them in the log
local seed = 0x12345678
local function rnd()
  seed = seed ~ ((seed << 13) & 0xFFFFFFFF)
  seed = seed & 0xFFFFFFFF
  seed = seed ~ (seed >> 17)
  seed = seed ~ ((seed << 5) & 0xFFFFFFFF)
  seed = seed & 0xFFFFFFFF
  return seed
end

local entries = {}
do
  local f = io.open("D:/repos/crenellation/romlab/out/entries.txt", "r")
  for line in f:lines() do
    local v = tonumber(line, 16)
    if v then entries[#entries + 1] = v end
  end
  f:close()
end

local frame, idx, trial = 0, 1, 0
local saved, returned, waited = nil, false, 0
local phase = "idle"
local TRIALS = 3
local dirty = {}          -- addr -> original byte, for the case in flight
local watching = false
local inregs = {}

local function dump_baseline()
  local t = {}
  for a = RAM_LO, RAM_HI do t[#t + 1] = string.char(space:read_u8(a)) end
  local fh = io.open(OUT .. "ram-baseline.bin", "wb")
  fh:write(table.concat(t))
  fh:close()
end

-- Capture at the instant of return.
--
-- Waiting for the next frame does not work: once the routine returns to the
-- sentinel the CPU carries on executing whatever lies there for the rest of
-- the frame, and trashes the very memory being compared. Recording inside the
-- tap takes the state at exactly the right moment.
local captured = nil

local function snapshot()
  local parts = {}
  for _, r in ipairs({ "D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3" }) do
    parts[#parts + 1] = string.format("%08X", cpu.state[r].value % 0x100000000)
  end
  local h1, h2 = 0, 0
  for i = 0, DIGEST_LEN - 1 do
    local b = space:read_u8(DIGEST_LO + i)
    h1 = (h1 * 31 + b) & 0xFFFFFFFF
    h2 = (h2 ~ (b + i)) & 0xFFFFFFFF
  end
  return table.concat(parts, " "), string.format("%08X%08X", h1, h2)
end

local function install()
  TAPS[#TAPS + 1] = space:install_read_tap(SENTINEL, SENTINEL + 1, "d",
    function(o, d, mask)
      if not returned then
        returned = true
        local regs, hash = snapshot()
        captured = { regs = regs, hash = hash }
      end
      return d
    end)
  TAPS[#TAPS + 1] = space:install_write_tap(RAM_LO, RAM_HI, "w",
    function(offset, d, mask)
      if watching and dirty[offset] == nil then
        dirty[offset] = space:read_u8(offset)
      end
      return d
    end)
end

local function save_regs()
  local s = {}
  for _, r in ipairs(REGS) do
    local ok, v = pcall(function() return cpu.state[r].value end)
    if ok then s[r] = v end
  end
  return s
end

local function restore_regs(s)
  for _, r in ipairs(REGS) do
    if s[r] then pcall(function() cpu.state[r].value = s[r] end) end
  end
end

local function restore_ram()
  for addr, b in pairs(dirty) do space:write_u8(addr, b) end
  dirty = {}
end

local function setup(entry)
  saved = save_regs()
  watching = true
  for i = 0, SCRATCH_LEN - 1 do space:write_u8(SCRATCH + i, rnd() % 256) end
  inregs = {}
  for k = 0, 7 do
    local v = rnd() % 0x10000
    inregs["D" .. k] = v
    cpu.state["D" .. k].value = v
  end
  for k = 0, 5 do
    local v = SCRATCH + (rnd() % (SCRATCH_LEN - 0x80))
    inregs["A" .. k] = v
    cpu.state["A" .. k].value = v
  end
  local sp = STACK
  for k = 1, 4 do
    sp = sp - 4
    space:write_u32(sp, (k % 2 == 0) and (rnd() % 0x100)
                    or (SCRATCH + (rnd() % (SCRATCH_LEN - 0x80))))
  end
  sp = sp - 4
  space:write_u32(sp, SENTINEL)
  cpu.state["SP"].value = sp
  cpu.state["A6"].value = STACK + 0x200
  -- Mask interrupts for the duration. Otherwise the vblank handler runs inside
  -- the routine under test, pushes onto its stack and advances shared state -
  -- the RNG seed among it - so the capture records the handler's effects too
  -- and nothing can reproduce it.
  cpu.state["SR"].value = 0x2700
  cpu.state["PC"].value = entry
  returned = false
  captured = nil
  waited = 0
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 400 then
    dump_baseline()
    install()
    phase = "run"
    log:write("baseline dumped" .. NL)
    log:flush()
    return
  end
  if phase ~= "run" then return end
  if idx > #entries then
    log:write("done " .. (idx - 1) .. NL); log:flush(); manager.machine:exit(); return
  end
  local entry = entries[idx]
  if not saved then setup(entry); return end
  waited = waited + 1
  if returned and captured then
    local ins = {}
    for k = 0, 7 do ins[#ins + 1] = string.format("%04X", inregs["D" .. k]) end
    for k = 0, 5 do ins[#ins + 1] = string.format("%06X", inregs["A" .. k]) end
    log:write(string.format("R %05X %d %s | %s | %s", entry, trial,
      table.concat(ins, " "), captured.regs, captured.hash) .. NL)
  elseif waited < 2 then
    return
  else
    log:write(string.format("N %05X %d", entry, trial) .. NL)
  end
  log:flush()
  watching = false
  restore_ram()
  restore_regs(saved)
  saved = nil
  trial = trial + 1
  if trial >= TRIALS then trial = 0; idx = idx + 1 end
end)
