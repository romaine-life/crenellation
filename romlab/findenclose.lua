-- Find the enclosure test. It must read the board densely right after a wall
-- is placed, so: watch work-RAM reads with CURPC, and look for a routine that
-- does a big burst of reads over one region immediately following a burst of
-- framebuffer writes (the wall going down).
local OUT="D:/repos/crenellation/romlab/out/enclose2/"
local log=io.open(OUT.."enclose.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local frame=0
local readers={}      -- curpc -> {n, lo, hi}
local function install()
  TAPS[#TAPS+1]=space:install_read_tap(0x200000,0x21FFFF,"bmp",function(offset,data,mask)
    local pc=cpu.state["CURPC"].value
    local e=readers[pc]
    if e then
      e.n=e.n+1
      if offset<e.lo then e.lo=offset end
      if offset>e.hi then e.hi=offset end
    else
      readers[pc]={n=1,lo=offset,hi=offset}
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
  if frame==9000 then
    local l={}
    for pc,e in pairs(readers) do
      -- a board scan touches a wide contiguous span many times
      if e.n>500 then l[#l+1]={pc=pc,n=e.n,lo=e.lo,hi=e.hi} end
    end
    table.sort(l,function(a,b) return a.n>b.n end)
    log:write("routines scanning a wide work-RAM span:"..NL)
    for i=1,math.min(#l,20) do
      log:write(string.format("  CURPC %06X  %8d reads  span %06X-%06X (%d bytes)",l[i].pc,l[i].n,l[i].lo,l[i].hi,l[i].hi-l[i].lo+1)..NL)
    end
    log:flush(); manager.machine:exit()
  end
end)
