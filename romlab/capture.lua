-- Drive Rampart to gameplay and dump the bitmap playfield + palette.
-- The terrain is drawn into :bitmap (512x256, 1 byte per pixel); :palette
-- holds the colours. Dumping RAM beats screenshotting: no sprites on top,
-- no scaling, exact indices.
local OUT = "D:/repos/crenellation/romlab/out/caps/"
local frame = 0
local dumps = 0

local ports = manager.machine.ioport.ports
local function field(port, name)
  local p = ports[port]
  if not p then return nil end
  return p.fields[name]
end

local coin = field(":IN1", "Coin 1")
local p1b1 = field(":IN1", "P1 Button 1")
local p1b2 = field(":IN1", "P1 Button 2")
local start_field = field(":IN1", "Service 1")

local log = io.open(OUT .. "capture.log", "w")
log:write(string.format("coin=%s p1b1=%s p1b2=%s\n", tostring(coin ~= nil), tostring(p1b1 ~= nil), tostring(p1b2 ~= nil)))

local function tap(f, on)
  if f then pcall(function() f:set_value(on and 1 or 0) end) end
end

local function dump()
  local ok, err = pcall(function()
    local bmp = manager.machine.memory.shares[":bitmap"]
    local pal = manager.machine.memory.shares[":palette"]
    local t = {}
    for i = 0, bmp.size - 1 do
      t[#t + 1] = string.char(bmp:read_u8(i))
    end
    local f = io.open(string.format("%sbitmap-%02d.bin", OUT, dumps), "wb")
    f:write(table.concat(t))
    f:close()
    local pt = {}
    for i = 0, pal.size - 1 do
      pt[#pt + 1] = string.char(pal:read_u8(i))
    end
    f = io.open(string.format("%spalette-%02d.bin", OUT, dumps), "wb")
    f:write(table.concat(pt))
    f:close()
    manager.machine.video:snapshot()
    log:write(string.format("frame %d: dumped %02d\n", frame, dumps))
    log:flush()
    dumps = dumps + 1
  end)
  if not ok then
    log:write("dump failed: " .. tostring(err) .. "\n")
    log:flush()
  end
end

-- Coin up, then mash both buttons through whatever menus stand between the
-- title screen and a battlefield; dump periodically once play should be live.
emu.register_frame_done(function()
  frame = frame + 1
  if frame == 120 then tap(coin, true) end
  if frame == 132 then tap(coin, false) end
  if frame == 180 then tap(coin, true) end
  if frame == 192 then tap(coin, false) end
  if frame > 240 and frame < 1800 then
    local phase = frame % 60
    if phase == 0 then tap(p1b1, true); tap(p1b2, true) end
    if phase == 12 then tap(p1b1, false); tap(p1b2, false) end
  end
  if frame >= 400 and frame % 200 == 0 and dumps < 24 then dump() end
  if frame > 5000 then manager.machine:exit() end
end)
