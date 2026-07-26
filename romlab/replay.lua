-- Differential capture: run every routine from known state and record it.
--
-- Two things make this harder than it looks, and both produced garbage before
-- being fixed:
--
--  * The capture must be taken at the instant the routine returns. Waiting for
--    the next frame lets the CPU run on past the sentinel and trash the memory
--    being compared.
--
--  * The game must not run between cases. If it does it advances shared state -
--    the RNG seed among it - so every case starts from different memory and
--    nothing on the other side can reproduce it. So cases are chained: the
--    sentinel tap records the result, sets up the next case and jumps straight
--    to it, and the game never executes at all. Work RAM is restored to a
--    baseline between cases, which the port loads too, so both sides start
--    byte-identical.
local OUT = "D:/repos/crenellation/romlab/out/replay/"
local log = io.open(OUT .. "f.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}

-- The sentinel must be an address whose contents are harmless to execute.
-- Setting the PC from inside the tap does not take effect until the CPU has
-- finished the instruction it is fetching, so one instruction at the sentinel
-- runs before the next case starts. In ROM that was arbitrary data - it was
-- adding 8 to d0 - so the sentinel lives in RAM with a nop written into it.
local SENTINEL = 0x3E6000
local PARK = 0x60FE   -- bra to self: the CPU spins here between cases
local RAM_LO, RAM_HI = 0x3E0000, 0x3EFFFF
local SCRATCH, SCRATCH_LEN = 0x3E4000, 0x400
local STACK = 0x3E5000
local DIGEST_LO, DIGEST_LEN = 0x3E4000, 0x2000
local TRIALS = 1

local seed = 0x12345678
local function rnd()
  seed = seed ~ ((seed << 13) & 0xFFFFFFFF)
  seed = seed & 0xFFFFFFFF
  seed = seed ~ (seed >> 17)
  seed = seed ~ ((seed << 5) & 0xFFFFFFFF)
  seed = seed & 0xFFFFFFFF
  return seed
end

-- Inputs are the arguments the game itself passed, recorded by callcap.lua.
-- Random values leave 203 routines never returning; real ones have valid
-- structures behind their pointers.
local cases = {}
do
  local f = io.open("D:/repos/crenellation/romlab/out/calls/replay.txt", "r")
  for line in f:lines() do
    local t = {}
    for w in line:gmatch("%S+") do t[#t + 1] = tonumber(w, 16) end
    if #t >= 24 then
      cases[#cases + 1] = { entry = t[1], d = { table.unpack(t, 2, 9) },
                            a = { table.unpack(t, 10, 16) },
                            stk = { table.unpack(t, 17, 25) } }
    end
  end
  f:close()
end
local entries = {}
for i, c in ipairs(cases) do entries[i] = c.entry end

local baseline = {}
local idx, trial = 1, 0
local frame = 0
local running = false
local startedFrame = 0
local inregs = {}
local stackargs = {}
local finished = false
local finishedOk = false
local dirty = {}

local function dump_baseline()
  local t = {}
  for a = RAM_LO, RAM_HI do
    local b = space:read_u8(a)
    baseline[a] = b
    t[#t + 1] = string.char(b)
  end
  local fh = io.open(OUT .. "ram-baseline.bin", "wb")
  fh:write(table.concat(t))
  fh:close()
end

local function restore_ram()
  for addr in pairs(dirty) do space:write_u8(addr, baseline[addr]) end
  dirty = {}
  -- Reset the whole of work RAM, not just the compared window. Routines read
  -- state far outside it - the RNG seed at 0x3E0842 is the clearest case - and
  -- any byte left drifting makes the run unreproducible on the other side.
  -- 64KB a case is affordable because the game is frozen while this runs.
  for a = RAM_LO, RAM_HI do
    space:write_u8(a, baseline[a])
  end
end

local function begin_case()
  if idx > #entries then
    if not finished then
      finished = true
      log:write("done " .. (idx - 1) .. NL)
      log:flush()
      manager.machine:exit()
    end
    return
  end
  restore_ram()
  space:write_u16(SENTINEL, PARK)
  local c = cases[idx]
  inregs = {}
  for k = 0, 7 do
    inregs["D" .. k] = c.d[k + 1]
    cpu.state["D" .. k].value = c.d[k + 1]
  end
  for k = 0, 5 do
    inregs["A" .. k] = c.a[k + 1]
    cpu.state["A" .. k].value = c.a[k + 1]
  end
  -- lay the observed stack out above a sentinel return address
  local sp = STACK
  stackargs = {}
  for k = 8, 1, -1 do
    sp = sp - 4
    space:write_u32(sp, c.stk[k + 1])
    stackargs[k] = c.stk[k + 1]
  end
  sp = sp - 4
  space:write_u32(sp, SENTINEL)
  cpu.state["SP"].value = sp
  cpu.state["A6"].value = STACK + 0x200
  cpu.state["SR"].value = 0x2700          -- interrupts off for the duration
  cpu.state["PC"].value = entries[idx]
  running = true
  startedFrame = frame
end

local function record(kind)
  local ins = {}
  for k = 0, 7 do ins[#ins + 1] = string.format("%04X", inregs["D" .. k]) end
  for k = 0, 5 do ins[#ins + 1] = string.format("%06X", inregs["A" .. k]) end
  for k = 1, 8 do ins[#ins + 1] = string.format("%08X", stackargs[k] or 0) end
  if kind == "R" then
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
    log:write(string.format("R %05X %d %s | %s | %08X%08X", entries[idx], trial,
      table.concat(ins, " "), table.concat(parts, " "), h1, h2) .. NL)
  else
    log:write(string.format("N %05X %d", entries[idx], trial) .. NL)
  end
  trial = trial + 1
  if trial >= TRIALS then trial = 0; idx = idx + 1 end
end

local function install()
  TAPS[#TAPS + 1] = space:install_read_tap(SENTINEL, SENTINEL + 1, "sent",
    function(o, d, mask)
      -- only note the return here. Starting the next case from inside the tap
      -- does not work: the CPU finishes its fetch at the sentinel first, and
      -- that fetch re-enters this tap and completes the next case before it has
      -- executed anything. Parking at the sentinel lets the frame handler take
      -- over safely.
      if running then
        running = false
        finishedOk = true
        record("R")
      end
      return d
    end)
  TAPS[#TAPS + 1] = space:install_write_tap(RAM_LO, RAM_HI, "w",
    function(offset, d, mask)
      if running then dirty[offset] = true end
      return d
    end)
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 400 then
    space:write_u16(SENTINEL, PARK)
    dump_baseline()
    install()
    log:write("baseline dumped" .. NL)
    log:flush()
    begin_case()
    return
  end
  if frame < 400 then return end
  if finishedOk then
    finishedOk = false
    begin_case()
    return
  end
  -- a case still running after a whole frame is hung on its random input
  if running and frame > startedFrame then
    running = false
    record("N")
    log:flush()
    begin_case()
  end
end)
