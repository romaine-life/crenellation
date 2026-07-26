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
local log = io.open(OUT .. "c.log", "w")
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
  if frame > 300 and frame < 48000 then
    local c = frame % 240
    if c == 0 then set(":IN1", "Coin 1", 1) end
    if c == 20 then set(":IN1", "Coin 1", 0) end
    if c == 40 then set(":IN1", "P1 Button 1", 1) end
    if c == 50 then set(":IN1", "P1 Button 1", 0) end
  end
  if frame > 500 then
    tx = (tx + 7) % 256; ty = (ty + 11) % 256
    set(":TRACK3", "Trackball X", tx); set(":TRACK2", "Trackball Y", ty)
    local q = frame % 45
    if q == 0 then set(":IN1", "P1 Button 1", 1) end
    if q == 6 then set(":IN1", "P1 Button 1", 0) end
    if q == 22 then set(":IN1", "P2 Button 1", 1) end
    if q == 28 then set(":IN1", "P2 Button 1", 0) end
  end
  -- capture in short windows: the tap fires on every instruction fetch, which
  -- is far too slow to leave on continuously
  local m = frame % 30
  if m == 0 and frame > 400 then capturing = true
  elseif m == 4 then capturing = false end
  if frame == 48000 then
    local covered = 0
    for _, c in pairs(seen) do if c > 0 then covered = covered + 1 end end
    log:write(string.format("# samples %d routines %d", n, covered) .. NL)
    log:flush()
    manager.machine:exit()
  end
end)
