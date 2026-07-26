-- The enclosure test runs once per round, so continuous traces drown it out.
-- Watch the phase countdown at 0x3E1870; when it resets (a phase change),
-- record work-RAM access by CURPC for a short window only.
local OUT="D:/repos/crenellation/romlab/out/phase/"
local log=io.open(OUT.."p.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local frame=0
local recording=false
local winEnd=0
local last=-1
local acc={}
local round=0
local function install()
  TAPS[#TAPS+1]=space:install_read_tap(0x3E0000,0x3E3FFF,"r",function(offset,data,mask)
    if not recording then return data end
    local pc=cpu.state["CURPC"].value
    if pc>=0x1A000 and pc<0x1C400 then return data end
    if offset>=0x3E3200 and offset<=0x3E3300 then return data end  -- stack
    local e=acc[pc]
    if e then e.n=e.n+1; if offset<e.lo then e.lo=offset end; if offset>e.hi then e.hi=offset end
    else acc[pc]={n=1,lo=offset,hi=offset} end
    return data
  end)
end
local function fld(p,n) local port=manager.machine.ioport.ports[p]; return port and port.fields[n] or nil end
local function set(p,n,v) local f=fld(p,n); if f then pcall(function() f:set_value(v) end) end end
emu.register_frame_done(function()
  frame=frame+1
  if frame==1200 then install() end
  if frame>600 then
    local c=frame%240
    if c==0 then set(":IN1","Coin 1",1) end
    if c==20 then set(":IN1","Coin 1",0) end
    local q=frame%25
    if q==0 then set(":IN1","P1 Button 1",1); set(":IN0","P2 Button 1",1) end
    if q==7 then set(":IN1","P1 Button 1",0); set(":IN0","P2 Button 1",0) end
  end
  if frame>1200 then
    local ok,t=pcall(function() return space:read_u8(0x3E1870) end)
    if ok then
      if last>=0 and t>last then
        -- phase just reset: capture the following moments
        recording=true; winEnd=frame+40; round=round+1
        log:write(string.format("phase change at frame %d (timer %d -> %d)",frame,last,t)..NL); log:flush()
      end
      last=t
    end
    if recording and frame>winEnd then recording=false end
  end
  if round>=8 then
    local l={}
    for pc,e in pairs(acc) do if e.n>200 then l[#l+1]={pc=pc,n=e.n,lo=e.lo,hi=e.hi} end end
    table.sort(l,function(a,b) return a.n>b.n end)
    log:write(NL.."routines active during phase changes:"..NL)
    for i=1,math.min(#l,20) do
      log:write(string.format("  CURPC %06X  %7d reads  %06X-%06X (%d bytes)",l[i].pc,l[i].n,l[i].lo,l[i].hi,l[i].hi-l[i].lo+1)..NL)
    end
    log:flush(); manager.machine:exit()
  end
end)
