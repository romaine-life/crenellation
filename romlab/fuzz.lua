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
local OUT = "D:/repos/crenellation/romlab/out/fuzz/"
-- One argument shape per run of the emulator. Eight shapes in a single run was
-- tried and lost most of the work: some shape drives a routine into a state
-- that kills MAME, and every entry after it in that run is gone. Split across
-- runs, a fatal shape costs only its own run.
local SHAPE = tonumber(os.getenv("FUZZSHAPE") or "-1")
local TRIALS = SHAPE >= 0 and 1 or 3
local log = io.open(OUT .. (SHAPE >= 0 and ("f-" .. SHAPE .. ".log") or "f.log"), "w")
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
-- Probed from the board, not assumed: work RAM is 0x3E0000-0x3FFFFF and the
-- playfield bitmap at 0x200000 is ordinary memory. Modelling only the first
-- 64 KiB left every routine that touched the rest comparing real data against
-- zeroes, which reads as a translation fault and is not one.
local RAM_LO, RAM_HI = 0x3E0000, 0x3FFFFF
local PF_LO, PF_HI = 0x200000, 0x21FFFF
local SCRATCH, SCRATCH_LEN = 0x3E4000, 0x400
local STACK = 0x3E5000
local DIGEST_LO, DIGEST_LEN = 0x3E4000, 0x2000

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

-- The structures the game passes around, recovered and verified earlier: the
-- board, the player array, the event queue, the moving-unit table, the shot
-- rings, the entity table, and the scratch window itself.
local STRUCTS = {
  0x3E0864, 0x3E1968, 0x3E1CF6, 0x3E1BC6, 0x3E0F48, 0x3E02D8, 0x3E4000,
}

local pfbase = {}

local function dump_range(lo, hi, store, name)
  local t = {}
  for a = lo, hi do
    local b = space:read_u8(a)
    store[a] = b
    t[#t + 1] = string.char(b)
  end
  local fh = io.open(OUT .. name, "wb")
  fh:write(table.concat(t))
  fh:close()
end

local function dump_baseline()
  dump_range(RAM_LO, RAM_HI, baseline, "ram-baseline.bin")
  dump_range(PF_LO, PF_HI, pfbase, "pf-baseline.bin")
end

-- The devices the port does not model: the palette, the two sound chips and
-- the input ports. A routine that reads one of them gets a real value on the
-- chip and zero in the port, so the two can never agree. The machine is frozen
-- while the harness runs, so a snapshot of what those addresses hold is enough
-- to make the reads comparable.
-- The read probe found more decoded space than the write probe did: a write
-- probe finds memory and misses every read-only decode. 0x140000 and 0x500000
-- are read by real routines, and 0x800000 turned out to be an exact mirror of
-- the program ROM, which needs no snapshot at all - just the fold.
local IO_BLOCKS = {
  {0x3C0000, 0x1000}, {0x460000, 0x1000}, {0x480000, 0x1000}, {0x640000, 0x1000},
  {0x140000, 0x40000}, {0x500000, 0x20000},
}

local function dump_io()
  local t = {}
  for _, blk in ipairs(IO_BLOCKS) do
    for i = 0, blk[2] - 1 do t[#t + 1] = string.char(space:read_u8(blk[1] + i)) end
  end
  local fh = io.open(OUT .. "io-baseline.bin", "wb")
  fh:write(table.concat(t)); fh:close()
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
  for a = PF_LO, PF_HI do
    space:write_u8(a, pfbase[a])
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
  for i = 0, SCRATCH_LEN - 1 do space:write_u8(SCRATCH + i, rnd() % 256) end
  inregs = {}
  -- Random values mostly prove a routine does not crash. A routine that wants
  -- a board pointer and a cell index gets neither from noise: it wanders and
  -- never reaches the sentinel, and the case is thrown away as "no return".
  -- Later trials therefore hand it the structures the game really passes and
  -- indices small enough to be in range. The number of draws is identical in
  -- every mode so the port's generator stays in step.
  -- Verification does not need plausible arguments, only identical ones on
  -- both sides and a result from the hardware. A routine that never returns
  -- yields nothing to compare, so several shapes are tried and whichever ones
  -- come back are the ones that get compared. The number of draws is the same
  -- in every shape, so the port's generator stays in step.
  local sh = SHAPE >= 0 and SHAPE or trial
  for k = 0, 7 do
    local r = rnd()
    local v
    if sh == 0 then v = r % 0x10000
    elseif sh == 1 then v = r % 32
    elseif sh == 2 then v = r % 256
    elseif sh == 3 then v = 0
    elseif sh == 4 then v = 1
    elseif sh == 5 then v = (r % 8)
    elseif sh == 6 then v = 0xFFFF
    else v = (r % 4) end
    inregs["D" .. k] = v
    cpu.state["D" .. k].value = v
  end
  for k = 0, 5 do
    local r = rnd()
    local v
    if sh == 0 then
      v = SCRATCH + (r % (SCRATCH_LEN - 0x80))
    elseif sh == 3 or sh == 6 then
      v = SCRATCH + 0x40 * k
    elseif sh == 4 then
      v = STRUCTS[1]
    elseif sh == 7 then
      v = STRUCTS[(k % #STRUCTS) + 1]
    elseif sh == 8 then
      v = STRUCTS[(r % #STRUCTS) + 1]
    else
      v = STRUCTS[(r % #STRUCTS) + 1]
    end
    inregs["A" .. k] = v
    cpu.state["A" .. k].value = v
  end
  local sp = STACK
  stackargs = {}
  for k = 1, 4 do
    sp = sp - 4
    local r = rnd()
    local v
    if sh == 8 then
      -- Structures on the stack as well as in the address registers. A routine
      -- that takes a structure pointer as a stack argument and is handed a
      -- random number walks off and never returns, and the case is lost - the
      -- same fault that made the instruction-boundary harness think the chip
      -- was crashing.
      v = STRUCTS[(r % #STRUCTS) + 1]
    elseif k % 2 == 0 then
      v = r % 0x100
    else
      v = SCRATCH + (r % (SCRATCH_LEN - 0x80))
    end
    space:write_u32(sp, v)
    stackargs[k] = v
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
  for k = 1, 4 do ins[#ins + 1] = string.format("%08X", stackargs[k] or 0) end
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

local function fld(pt, f)
  local q = manager.machine.ioport.ports[pt]
  return q and q.fields[f] or nil
end
local function set(pt, f, v)
  local q = fld(pt, f)
  if q then pcall(function() q:set_value(v) end) end
end

-- Coin up and start a game before taking the baseline. The old baseline was
-- captured in attract mode, so every routine that wants a board, a player or a
-- live entity found none, wandered off and never returned - and the case was
-- discarded as "no return" rather than compared. Starting a real game first
-- gives them state that makes sense.
local START = 2400

emu.register_frame_done(function()
  frame = frame + 1
  -- Kick the watchdog: the harness freezes the game for a frame per case, so
  -- nothing else does, and the board resets. The game kicks it the same way.
  space:write_u16(0x72FFFE, 0)
  if frame < START then
    local c = frame % 240
    if c == 0 then set(":IN1", "Coin 1", 1) end
    if c == 20 then set(":IN1", "Coin 1", 0) end
    if c == 40 then set(":IN1", "P1 Button 1", 1) end
    if c == 50 then set(":IN1", "P1 Button 1", 0) end
    local q = frame % 45
    if q == 0 then set(":IN1", "P1 Button 1", 1) end
    if q == 6 then set(":IN1", "P1 Button 1", 0) end
  end
  if frame == START then
    space:write_u16(SENTINEL, PARK)
    dump_baseline()
    dump_io()
    install()
    log:write("baseline dumped" .. NL)
    log:flush()
    begin_case()
    return
  end
  if frame < START then return end
  if finishedOk then
    finishedOk = false
    begin_case()
    return
  end
  -- a case still running after a whole frame is hung on its random input
  -- One frame only. Giving a stuck routine longer does not rescue it: it lets
  -- wild execution reach an address error, and with the vector table in the
  -- state the harness leaves it that becomes a double fault and halts the CPU
  -- for every case after it. Measured - an eight-frame window took the
  -- routines that returned from 400 down to 13.
  if running and frame > startedFrame then
    running = false
    record("N")
    log:flush()
    begin_case()
  end
end)
