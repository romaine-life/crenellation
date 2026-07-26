-- Measure cannon behaviour: watch the bitmap for wall destruction and the
-- sound queue for the fire/impact cues, so flight time and blast radius come
-- from the game rather than from taste.
local OUT="D:/repos/crenellation/romlab/out/shots/"
local log=io.open(OUT.."shots.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local frame=0
-- sound ids seen, with the frame they were queued: fire and explosion cues
-- bracket a shot's flight.
local function install()
  TAPS[#TAPS+1]=space:install_write_tap(0x3E3D46,0x3E3D55,"q",function(offset,data,mask)
    local v=data & 0xFF
    if v>0 then log:write(string.format("%d queue %d",frame,v)..NL); log:flush() end
    return data
  end)
end
local function fld(p,n) local port=manager.machine.ioport.ports[p]; return port and port.fields[n] or nil end
local function set(p,n,v) local f=fld(p,n); if f then pcall(function() f:set_value(v) end) end end
emu.register_frame_done(function()
  frame=frame+1
  if frame==600 then install() end
  if frame>650 then
    local c=frame%240
    if c==0 then set(":IN1","Coin 1",1) end
    if c==20 then set(":IN1","Coin 1",0) end
    local q=frame%20
    if q==0 then set(":IN1","P1 Button 1",1); set(":IN0","P2 Button 1",1) end
    if q==6 then set(":IN1","P1 Button 1",0); set(":IN0","P2 Button 1",0) end
  end
  if frame==14000 then manager.machine:exit() end
end)
