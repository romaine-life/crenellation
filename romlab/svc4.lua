-- Continuous trackball motion (a real trackball reports small deltas every
-- frame, not one big jump), then select PLAYFIELD TEST.
local OUT = "D:/repos/crenellation/romlab/out/svc4/"
local log = io.open(OUT .. "svc4.log", "w")
local frame, dumps, ty = 0, 0, 0

local function fld(p, n)
  local port = manager.machine.ioport.ports[p]
  return port and port.fields[n] or nil
end
local svc = fld(":IN1", "Service Mode")
local place = fld(":IN1", "P1 Button 1")
local tby = fld(":TRACK2", "Trackball Y")
local function set(f, v) if f then pcall(function() f:set_value(v) end) end end

local function dump(tag)
  pcall(function()
    local bmp = manager.machine.memory.shares[":bitmap"]
    local pal = manager.machine.memory.shares[":palette"]
    local t = {}
    for i = 0, bmp.size - 1 do t[#t + 1] = string.char(bmp:read_u8(i)) end
    local fh = io.open(string.format("%sbitmap-%02d.bin", OUT, dumps), "wb"); fh:write(table.concat(t)); fh:close()
    local pt = {}
    for i = 0, pal.size - 1 do pt[#pt + 1] = string.char(pal:read_u8(i)) end
    fh = io.open(string.format("%spalette-%02d.bin", OUT, dumps), "wb"); fh:write(table.concat(pt)); fh:close()
    log:write(string.format("frame %d dump %02d %s ty=%d\n", frame, dumps, tag, ty % 256)); log:flush()
    dumps = dumps + 1
  end)
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 60 then set(svc, 1) end

  -- Smooth roll downward for ~6 seconds.
  if frame > 600 and frame < 1000 then
    ty = ty + 3
    set(tby, ty % 256)
  end
  if frame > 600 and frame < 1000 and frame % 80 == 0 then dump("rolling") end

  if frame == 1100 then set(place, 1) end
  if frame == 1120 then set(place, 0); log:write("place pressed\n"); log:flush() end
  if frame > 1200 and frame % 200 == 0 and dumps < 26 then dump("after") end
  if dumps >= 26 or frame > 9000 then manager.machine:exit() end
end)
