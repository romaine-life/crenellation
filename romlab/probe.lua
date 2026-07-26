local out=io.open("D:/repos/crenellation/romlab/out/music/probe.txt","w")
local NL=string.char(10)
for _,tag in ipairs({":oki", ":ymsnd"}) do
  local d = manager.machine.devices[tag]
  out:write("device "..tag.." present="..tostring(d~=nil)..NL)
  if d then
    local ok,err = pcall(function()
      for k,v in pairs(getmetatable(d).__index or {}) do out:write("   method "..tostring(k)..NL) end
    end)
    if not ok then out:write("   introspect failed: "..tostring(err)..NL) end
    out:write("   has set_output_gain: "..tostring(d.set_output_gain~=nil)..NL)
    local ok2,err2 = pcall(function() d:set_output_gain(-1, 0.0) end)
    out:write("   set_output_gain(-1,0) ok="..tostring(ok2).." "..tostring(err2)..NL)
  end
end
out:close()
manager.machine:exit()
