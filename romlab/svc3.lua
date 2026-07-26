-- Navigate the service menu to PLAYFIELD TEST (7 entries below the default
-- STATISTICS) using the trackball, then select it with the place button and
-- capture whatever it draws — likely the terrain/playfield art, possibly all
-- the battlefields.
local OUT = "D:/repos/crenellation/romlab/out/svc3/"
local log = io.open(OUT .. "svc2.log", "w")
local frame, dumps = 0, 0
local ty = 0

local function fld(p, n)
  local port = manager.machine.ioport.ports[p]
  return port and port.fields[n] or nil
end
local svc = fld(":IN1", "Service Mode")
local place = fld(":IN1", "P1 Button 1")
local tby = fld(":TRACK2", "Trackball Y")
local tbx = fld(":TRACK3", "Trackball X")
local function set(f, v) if f then pcall(function() f:set_value(v) end) end end

log:write(string.format("svc=%s place=%s trackY=%s trackX=%s\n",
  tostring(svc ~= nil), tostring(place ~= nil), tostring(tby ~= nil), tostring(tbx ~= nil)))
log:flush()

local function dump(tag)
  local ok, err = pcall(function()
    local bmp = manager.machine.memory.shares[":bitmap"]
    local pal = manager.machine.memory.shares[":palette"]
    local t = {}
    for i = 0, bmp.size - 1 do t[#t + 1] = string.char(bmp:read_u8(i)) end
    local fh = io.open(string.format("%sbitmap-%02d.bin", OUT, dumps), "wb"); fh:write(table.concat(t)); fh:close()
    local pt = {}
    for i = 0, pal.size - 1 do pt[#pt + 1] = string.char(pal:read_u8(i)) end
    fh = io.open(string.format("%spalette-%02d.bin", OUT, dumps), "wb"); fh:write(table.concat(pt)); fh:close()
    log:write(string.format("frame %d dump %02d (%s)\n", frame, dumps, tag)); log:flush()
    dumps = dumps + 1
  end)
  if not ok then log:write("dump fail " .. tostring(err) .. "\n"); log:flush() end
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 60 then set(svc, 1) end

  -- Roll the trackball down in steps; the menu highlight should walk down.
  if frame > 700 and frame <= 700 + 7 * 60 and (frame - 700) % 60 == 0 then
    ty = ty + 24
    set(tby, ty % 256)
    log:write(string.format("frame %d trackball Y -> %d\n", frame, ty % 256)); log:flush()
    dump("nav")
  end

  -- Select whatever is highlighted, then keep capturing what it shows.
  if frame == 1500 then set(place, 1) end
  if frame == 1520 then set(place, 0); log:write("place pressed\n"); log:flush() end

  if frame > 1300 and frame % 180 == 0 and dumps < 30 then dump("after-select") end

  -- Nudge occasionally in case the test needs input to advance pages.
  if frame > 1400 then
    local q = frame % 300
    if q == 0 then set(place, 1) end
    if q == 15 then set(place, 0) end
  end

  if dumps >= 30 or frame > 9000 then
    log:write("done dumps=" .. dumps .. "\n"); log:flush()
    manager.machine:exit()
  end
end)
