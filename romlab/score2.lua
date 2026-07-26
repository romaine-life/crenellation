local OUT="D:/repos/crenellation/romlab/out/score/"
local log=io.open(OUT.."deltas.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local frame=0
local last=nil
local function install()
  TAPS[#TAPS+1]=space:install_write_tap(0x3E19F4,0x3E19F5,"score",function(offset,data,mask)
    local v=data & 0xFFFF
    if last and v>last then log:write(string.format("%d +%d -> %d",frame,v-last,v)..NL); log:flush() end
    last=v
    return data
  end)
end
local function fld(p,n) local port=manager.machine.ioport.ports[p]; return port and port.fields[n] or nil end
local function set(p,n,v) local f=fld(p,n); if f then pcall(function() f:set_value(v) end) end end
emu.register_frame_done(function()
  frame=frame+1
  if frame==1500 then install() end
  if frame>600 then
    local c=frame%240
    if c==0 then set(":IN1","Coin 1",1) end
    if c==20 then set(":IN1","Coin 1",0) end
    local q=frame%25
    if q==0 then set(":IN1","P1 Button 1",1); set(":IN0","P2 Button 1",1) end
    if q==7 then set(":IN1","P1 Button 1",0); set(":IN0","P2 Button 1",0) end
  end
  if frame==30000 then manager.machine:exit() end
end)
