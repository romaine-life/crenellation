-- Measure score awards by correlating monotonic RAM words with events:
-- round boundaries (the countdown resetting) and battle hits.
local OUT="D:/repos/crenellation/romlab/out/score/"
local log=io.open(OUT.."events.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local frame=0
local prev={}
local lastTimer=-1
local function install()
  TAPS[#TAPS+1]=space:install_write_tap(0x3E0000,0x3E3FFF,"ram",function(offset,data,mask)
    if (offset % 2)==0 then
      local v=data & 0xFFFF
      local p=prev[offset]
      if p and v>p and (v-p)<=5000 then
        log:write(string.format("D %d %06X %d %d",frame,offset,v-p,v)..NL)
      end
      prev[offset]=v
    end
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
  if frame>1500 then
    local ok,t=pcall(function() return space:read_u8(0x3E1870) end)
    if ok and t~=lastTimer then
      if lastTimer>=0 and t>lastTimer then log:write(string.format("R %d %d",frame,t)..NL) end
      lastTimer=t
    end
  end
  if frame==40000 then log:flush(); manager.machine:exit() end
end)
