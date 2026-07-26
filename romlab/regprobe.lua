local log=io.open("D:/repos/crenellation/romlab/out/regions.txt","w")
local NL=string.char(10)
for name,r in pairs(manager.machine.memory.regions) do
  log:write(string.format("REGION %s size=%d", name, r.size)..NL)
end
for name,s in pairs(manager.machine.memory.shares) do
  log:write(string.format("SHARE %s size=%d", name, s.size)..NL)
end
log:flush(); log:close()
emu.register_frame_done(function() manager.machine:exit() end)
