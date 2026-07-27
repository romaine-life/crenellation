local f = io.open("D:/repos/crenellation/romlab/out/wdprobe.txt", "w")
local NL = string.char(10)
local frame = 0
emu.register_frame_done(function()
  frame = frame + 1
  if frame ~= 60 then return end
  local w = manager.machine.devices[":watchdog"]
  local mt = getmetatable(w)
  if mt then
    for k, _ in pairs(mt) do f:write("meta " .. tostring(k) .. NL) end
  end
  for k, _ in pairs(w) do f:write("field " .. tostring(k) .. NL) end
  f:flush()
  manager.machine:exit()
end)
