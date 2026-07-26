-- Record the arguments the game actually passes to each routine.
--
-- Random inputs are a poor test: 203 of 593 routines never return at all when
-- handed garbage pointers, and many that do return take absurd paths. Real
-- calls have valid structures behind their pointers, so a replay driven by
-- observed arguments exercises the paths the game really uses.
--
-- This records, for each routine entry the CPU reaches during play, the
-- register state and the top of the stack. A later pass replays those exact
-- inputs through the controlled harness, where outputs can be captured.
local OUT = "D:/repos/crenellation/romlab/out/calls/"
-- Several passes over the game reach different code. Each writes its own log
-- and they are merged: attract and play never run the self-test, and the
-- self-test never runs the board code.
local MODE = os.getenv("CAPMODE") or "play"
local DUTY = os.getenv("CAPDUTY") or "window"
local STOP = tonumber(os.getenv("CAPSTOP") or "90000")
local log = io.open(OUT .. "c-" .. MODE .. ".log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}

local PER_ROUTINE = 4          -- samples to keep per routine
local entries = {}
local seen = {}
local frame, tx, ty, n = 0, 0, 0, 0
local capturing = false

do
  local f = io.open("D:/repos/crenellation/romlab/out/entries.txt", "r")
  for line in f:lines() do
    local v = tonumber(line, 16)
    if v then entries[v] = true; seen[v] = 0 end
  end
  f:close()
end

local function fld(p, f) local q = manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p, f, v) local q = fld(p, f); if q then pcall(function() q:set_value(v) end) end end

local function record(pc)
  local sp = cpu.state["SP"].value
  local parts = {}
  for k = 0, 7 do parts[#parts + 1] = string.format("%08X", cpu.state["D" .. k].value % 0x100000000) end
  for k = 0, 6 do parts[#parts + 1] = string.format("%08X", cpu.state["A" .. k].value % 0x100000000) end
  parts[#parts + 1] = string.format("%08X", sp % 0x100000000)
  -- the return address plus eight longs of arguments above it
  for i = 0, 8 do
    parts[#parts + 1] = string.format("%08X", space:read_u32(sp + i * 4))
  end
  log:write(string.format("C %05X %s", pc, table.concat(parts, " ")) .. NL)
  n = n + 1
end

local function install()
  TAPS[#TAPS + 1] = space:install_read_tap(0x000000, 0x01FFFF, "entry",
    function(offset, d, mask)
      if not capturing then return d end
      local pc = cpu.state["CURPC"].value
      if entries[pc] and seen[pc] < PER_ROUTINE then
        seen[pc] = seen[pc] + 1
        record(pc)
      end
      return d
    end)
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 300 then install() end
  if MODE == "service" then
    -- held from frame 1: the self-test is entered out of the power-on check,
    -- long before any of the play inputs are touched
    set(":IN1", "Service Mode", 1)
    if frame % 300 == 120 then set(":IN1", "Service 1", 1) end
    if frame % 300 == 150 then set(":IN1", "Service 1", 0) end
    if frame % 300 == 200 then set(":IN1", "P1 Button 1", 1) end
    if frame % 300 == 220 then set(":IN1", "P1 Button 1", 0) end
    tx = (tx + 5) % 256; ty = (ty + 3) % 256
    set(":TRACK3", "Trackball X", tx); set(":TRACK2", "Trackball Y", ty)
    local m2 = frame % 30
    if m2 == 0 and frame > 60 then capturing = true
    elseif m2 == 6 then capturing = false end
    if frame == 30 then install() end
    if frame == 30000 then
      local covered = 0
      for _, c in pairs(seen) do if c > 0 then covered = covered + 1 end end
      log:write(string.format("# samples %d routines %d", n, covered) .. NL)
      log:flush()
      manager.machine:exit()
    end
    return
  end
  -- Drive every input the board has, not the two that were guessed at. A
  -- routine is only recorded if the game calls it, and most of the ones that
  -- were never exercised are ordinary play code the previous run simply never
  -- reached: second and third player, the other buttons, all four trackball
  -- axes, and the self-test that only runs with the service switch held.
  if frame > 300 and frame < 60000 then
    local c = frame % 240
    if c == 0 then set(":IN1", "Coin 1", 1); set(":IN1", "Coin 2", 1) end
    if c == 20 then set(":IN1", "Coin 1", 0); set(":IN1", "Coin 2", 0) end
    if c == 40 then set(":IN1", "P1 Button 1", 1); set(":IN0", "P2 Button 1", 1) end
    if c == 50 then set(":IN1", "P1 Button 1", 0); set(":IN0", "P2 Button 1", 0) end
    if c == 60 then set(":P3", "P3 Button 1", 1) end
    if c == 70 then set(":P3", "P3 Button 1", 0) end
  end
  -- a spell in service mode, which is the only way into the self-test
  if frame == 60000 then set(":IN1", "Service Mode", 1) end
  if frame == 64000 then set(":IN1", "Service Mode", 0) end
  if frame > 64200 and frame % 900 == 0 then set(":IN1", "Service 1", 1) end
  if frame > 64200 and frame % 900 == 30 then set(":IN1", "Service 1", 0) end
  if frame > 500 then
    -- vary the direction as well as the speed, so the cursor sweeps the board
    -- instead of drifting one way forever
    local phase = (frame // 600) % 4
    local dx = (phase == 0 and 7) or (phase == 1 and -5) or (phase == 2 and 13) or -11
    local dy = (phase == 0 and 11) or (phase == 1 and 9) or (phase == 2 and -7) or -3
    tx = (tx + dx) % 256; ty = (ty + dy) % 256
    set(":TRACK3", "Trackball X", tx); set(":TRACK2", "Trackball Y", ty)
    set(":TRACK1", "Trackball X 2", ty); set(":TRACK0", "Trackball Y 2", tx)
    set(":TRACK1", "Trackball X 3", tx); set(":TRACK0", "Trackball Y 3", ty)
    local q = frame % 45
    if q == 0 then set(":IN1", "P1 Button 1", 1) end
    if q == 6 then set(":IN1", "P1 Button 1", 0) end
    if q == 12 then set(":IN1", "P1 Button 2", 1) end
    if q == 16 then set(":IN1", "P1 Button 2", 0) end
    if q == 22 then set(":IN0", "P2 Button 1", 1) end
    if q == 28 then set(":IN0", "P2 Button 1", 0) end
    if q == 33 then set(":IN0", "P2 Button 2", 1); set(":P3", "P3 Button 2", 1) end
    if q == 38 then set(":IN0", "P2 Button 2", 0); set(":P3", "P3 Button 2", 0) end
    if q == 41 then set(":P3", "P3 Button 1", 1) end
    if q == 44 then set(":P3", "P3 Button 1", 0) end
  end
  -- The tap fires on every instruction fetch, so this used to run for four
  -- frames in every thirty. That misses most of what the game calls: a routine
  -- reached once per level, or on one branch of a menu, almost never lands in
  -- a window. Continuous capture is several times slower and worth it, since
  -- the whole point is which routines get called at all.
  local m = frame % 30
  if DUTY == "full" then
    capturing = frame > 400
  elseif m == 0 and frame > 400 then capturing = true
  elseif m == 4 then capturing = false end
  if frame == STOP then
    local covered = 0
    for _, c in pairs(seen) do if c > 0 then covered = covered + 1 end end
    log:write(string.format("# samples %d routines %d", n, covered) .. NL)
    log:flush()
    manager.machine:exit()
  end
end)
