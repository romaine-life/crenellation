-- Why doesn't the simulated coin register? Watch the actual port bits while
-- driving the field several different ways.
local OUT = "D:/repos/crenellation/romlab/out/"
local log = io.open(OUT .. "diag.log", "w")
local frame = 0

local ports = manager.machine.ioport.ports
local in1 = ports[":IN1"]
local coin = in1 and in1.fields["Coin 1"]

log:write(string.format("in1=%s coin=%s\n", tostring(in1 ~= nil), tostring(coin ~= nil)))
if coin then
  log:write(string.format("coin mask=%s defvalue=%s type=%s\n",
    tostring(coin.mask), tostring(coin.defvalue), tostring(coin.type)))
end

local function readport()
  local ok, v = pcall(function() return in1:read() end)
  return ok and string.format("%04x", v) or ("ERR " .. tostring(v))
end

-- Three techniques, one after another, each with a long hold.
emu.register_frame_done(function()
  frame = frame + 1

  if frame == 200 then
    log:write("baseline port=" .. readport() .. "\n")
    log:write("technique A: set_value(1)\n")
    pcall(function() coin:set_value(1) end)
  end
  if frame == 205 then log:write("  A held port=" .. readport() .. "\n") end
  if frame == 260 then
    pcall(function() coin:set_value(0) end)
    log:write("  A released port=" .. readport() .. "\n")
  end

  if frame == 400 then
    log:write("technique B: set_value(mask)\n")
    pcall(function() coin:set_value(coin.mask) end)
  end
  if frame == 405 then log:write("  B held port=" .. readport() .. "\n") end
  if frame == 460 then pcall(function() coin:set_value(0) end) end

  if frame == 600 then
    log:write("technique C: set_value(0) as active-low press\n")
    pcall(function() coin:set_value(0) end)
  end
  if frame == 605 then log:write("  C held port=" .. readport() .. "\n") end
  if frame == 660 then pcall(function() coin:set_value(1) end) end

  if frame == 800 then
    log:write("final port=" .. readport() .. "\n")
    log:flush()
    manager.machine.video:snapshot()
    manager.machine:exit()
  end
end)
