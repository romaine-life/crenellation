-- List the input fields the driver exposes, so the capture can drive all of
-- them rather than the two that were guessed at.
local f = io.open("D:/repos/crenellation/romlab/out/ports.txt", "w")
local NL = string.char(10)
local frame = 0
emu.register_frame_done(function()
  frame = frame + 1
  if frame ~= 60 then return end
  for tag, port in pairs(manager.machine.ioport.ports) do
    for name, field in pairs(port.fields) do
      f:write(string.format("%-10s %s", tag, name) .. NL)
    end
  end
  f:flush()
  manager.machine:exit()
end)
