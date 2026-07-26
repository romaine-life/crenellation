-- Capture state and screen on consecutive frames, to establish which frame's
-- display list the rendered screen actually corresponds to.
local OUT="D:/repos/crenellation/romlab/out/skew/"
local log=io.open(OUT.."s.log","w"); local NL=string.char(10)
local frame=0; local tx,ty=0,0
local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end
local function dshare(n,f)
  local s=manager.machine.memory.shares[n]; if not s then return end
  local t={} for i=0,s.size-1 do t[#t+1]=string.char(s:read_u8(i)) end
  local h=io.open(OUT..f,"wb"); h:write(table.concat(t)); h:close()
end
local function cap(tag)
  dshare(":mob","mob-"..tag..".bin"); dshare(":mob:slip","slip-"..tag..".bin")
  dshare(":bitmap","bmp-"..tag..".bin"); dshare(":palette","pal-"..tag..".bin")
  local scr=manager.machine.screens[":screen"]
  local ok,px=pcall(function() return scr:pixels() end)
  if ok and px then local h=io.open(OUT.."scr-"..tag..".bin","wb"); h:write(px); h:close() end
  log:write("CAP "..tag..NL); log:flush()
end
emu.register_frame_done(function()
  frame=frame+1
  if frame==100 then
    local r=manager.machine.memory.regions[":gfx"]
    local t={} for i=0,r.size-1 do t[#t+1]=string.char(r:read_u8(i)) end
    local h=io.open(OUT.."gfx.bin","wb"); h:write(table.concat(t)); h:close()
  end
  if frame>600 and frame<3000 then
    local c=frame%240
    if c==0 then set(":IN1","Coin 1",1) end
    if c==20 then set(":IN1","Coin 1",0) end
    if c==40 then set(":IN1","P1 Button 1",1) end
    if c==50 then set(":IN1","P1 Button 1",0) end
  end
  if frame>900 then
    tx=(tx+7)%256; ty=(ty+11)%256
    set(":TRACK3","Trackball X",tx); set(":TRACK2","Trackball Y",ty)
    local q=frame%45
    if q==0 then set(":IN1","P1 Button 1",1) end
    if q==6 then set(":IN1","P1 Button 1",0) end
  end
  if frame>=3180 and frame<=3220 then cap(tostring(frame)) end
  if frame==3225 then manager.machine:exit() end
end)
