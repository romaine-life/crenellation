-- Capture the music two ways at once:
--   1. Swallow every CPU write to the OKI6295 (0x460000) so no sound effects
--      or speech play -- what -wavwrite records is then FM music only.
--   2. Log every YM2413 register write (0x480000-0x480003) with a timestamp,
--      so a VGM file (the chiptune-standard register log) can be built.
local OUT = "D:/repos/crenellation/romlab/out/music/"
local log = io.open(OUT .. "ym2413.log", "w")
local info = io.open(OUT .. "musiclog.txt", "w")
local NL = string.char(10)
local frame = 0

local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}

local ym = manager.machine.devices[":ymsnd"]
local okd = manager.machine.devices[":oki"]
local ok, err = pcall(function()
  info:write("ymsnd clock=" .. tostring(ym.clock) .. NL)
  info:write("oki clock=" .. tostring(okd.clock) .. NL)
end)
if not ok then info:write("clock read failed: " .. tostring(err) .. NL) end
info:flush()

local function now()
  local t = manager.machine.time
  local ok2, v = pcall(function() return t:as_double() end)
  if ok2 then return v end
  return t.seconds + (t.attoseconds / 1e18)
end

local function install()
  -- Mirrors matter: the driver mirrors OKI by 0x019ffe and YM by 0x019ffc,
  -- so tap the whole mirrored window rather than the base address alone.
  TAPS[#TAPS + 1] = space:install_write_tap(0x460000, 0x479fff, "okimute", function(offset, data, mask)
    return 0
  end)
  TAPS[#TAPS + 1] = space:install_write_tap(0x480000, 0x499fff, "ymlog", function(offset, data, mask)
    -- umask16(0xff00): the chip takes the upper byte of the word.
    local val = (data >> 8) & 0xFF
    local reg = offset & 3
    log:write(string.format("%.6f %d %02X", now(), reg, val) .. NL)
    return data
  end)
  info:write("taps installed at frame " .. frame .. NL)
  info:flush()
end

local function fld(p, n)
  local port = manager.machine.ioport.ports[p]
  return port and port.fields[n] or nil
end
local function set(p, n, v)
  local f = fld(p, n)
  if f then pcall(function() f:set_value(v) end) end
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install() end
  if frame > 650 then
    local c = frame % 240
    if c == 0 then set(":IN1", "Coin 1", 1) end
    if c == 20 then set(":IN1", "Coin 1", 0) end
    local q = frame % 30
    if q == 0 then set(":IN1", "P1 Button 1", 1); set(":IN0", "P2 Button 1", 1) end
    if q == 8 then set(":IN1", "P1 Button 1", 0); set(":IN0", "P2 Button 1", 0) end
  end
end)
