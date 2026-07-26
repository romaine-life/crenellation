local out=io.open("D:/repos/crenellation/romlab/out/verify/regs.txt","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local ok,err=pcall(function()
  for k,v in pairs(cpu.state) do
    out:write(tostring(k).." = "..tostring(v.value)..NL)
  end
end)
if not ok then out:write("iterate failed: "..tostring(err)..NL) end
out:close()
manager.machine:exit()
