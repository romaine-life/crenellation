-- Enter the operator/service menu and page through it. Atari test menus often
-- expose game options; anything resembling level/map selection would let us
-- capture every battlefield directly.
local OUT = "D:/repos/crenellation/romlab/out/svc/"
local log = io.open(OUT .. "svc.log", "w")
local frame, dumps = 0, 0

local function fld(p, n)
  local port = manager.machine.ioport.ports[p]
  return port and port.fields[n] or nil
end
local svc = fld(":IN1", "Service Mode")
local svc1 = fld(":IN1", "Service 1")
local fire = fld(":IN1", "P1 Button 1")
local fire2 = fld(":IN1", "P1 Button 2")
local function set(f, v) if f then pcall(function() f:set_value(v) end) end end

log:write(string.format("svc=%s svc1=%s\n", tostring(svc ~= nil), tostring(svc1 ~= nil)))

local function dump()
  local ok, err = pcall(function()
    local bmp = manager.machine.memory.shares[":bitmap"]
    local pal = manager.machine.memory.shares[":palette"]
    local t = {}
    for i = 0, bmp.size - 1 do t[#t + 1] = string.char(bmp:read_u8(i)) end
    local fh = io.open(string.format("%sbitmap-%02d.bin", OUT, dumps), "wb"); fh:write(table.concat(t)); fh:close()
    local pt = {}
    for i = 0, pal.size - 1 do pt[#pt + 1] = string.char(pal:read_u8(i)) end
    fh = io.open(string.format("%spalette-%02d.bin", OUT, dumps), "wb"); fh:write(table.concat(pt)); fh:close()
    dumps = dumps + 1
  end)
  if not ok then log:write("dump fail " .. tostring(err) .. "\n"); log:flush() end
end

emu.register_frame_done(function()
  frame = frame + 1

  -- Hold the service switch on from early boot so the test menu comes up.
  if frame == 60 then set(svc, 1); log:write("service mode ON\n"); log:flush() end

  -- Page through menu entries with service/start presses.
  if frame > 600 then
    local q = frame % 90
    if q == 0 then set(svc1, 1) end
    if q == 12 then set(svc1, 0) end
    local r = frame % 150
    if r == 0 then set(fire, 1); set(fire2, 1) end
    if r == 15 then set(fire, 0); set(fire2, 0) end
  end

  if frame > 400 and frame % 240 == 0 and dumps < 24 then dump() end
  if dumps >= 24 or frame > 8000 then
    log:write("done dumps=" .. dumps .. "\n"); log:flush()
    manager.machine:exit()
  end
end)
