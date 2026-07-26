local OUT="D:/repos/crenellation/romlab/out/timers/"
local log=io.open(OUT.."timer2.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local frame=0
local last=-1
local function fld(p,n) local port=manager.machine.ioport.ports[p]; return port and port.fields[n] or nil end
local function set(p,n,v) local f=fld(p,n); if f then pcall(function() f:set_value(v) end) end end
emu.register_frame_done(function()
  frame=frame+1
  if frame>600 then
    local c=frame%240
    if c==0 then set(":IN1","Coin 1",1) end
    if c==20 then set(":IN1","Coin 1",0) end
    local q=frame%20
    if q==0 then set(":IN1","P1 Button 1",1); set(":IN0","P2 Button 1",1) end
    if q==6 then set(":IN1","P1 Button 1",0); set(":IN0","P2 Button 1",0) end
  end
  if frame>1200 then
    local ok,v=pcall(function() return space:read_u8(0x3E1870) end)
    if ok and v~=last then
      log:write(string.format("%d %d",frame,v)..NL); log:flush()
      last=v
    end
  end
  if frame==24000 then manager.machine:exit() end
end)
