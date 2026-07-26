-- Identify every routine that writes the framebuffer, using CURPC (the
-- executing instruction) rather than PC (which points at the next one).
local OUT="D:/repos/crenellation/romlab/out/writers/"
local log=io.open(OUT.."writers.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local frame=0
local pcs={}
local function install()
  TAPS[#TAPS+1]=space:install_write_tap(0x200000,0x21FFFF,"bmp",function(offset,data,mask)
    local pc=cpu.state["CURPC"].value
    pcs[pc]=(pcs[pc] or 0)+1
    return data
  end)
end
local function fld(p,n) local port=manager.machine.ioport.ports[p]; return port and port.fields[n] or nil end
local function set(p,n,v) local f=fld(p,n); if f then pcall(function() f:set_value(v) end) end end
emu.register_frame_done(function()
  frame=frame+1
  if frame==400 then install() end
  if frame>600 then
    local c=frame%240
    if c==0 then set(":IN1","Coin 1",1) end
    if c==20 then set(":IN1","Coin 1",0) end
    local q=frame%25
    if q==0 then set(":IN1","P1 Button 1",1); set(":IN0","P2 Button 1",1) end
    if q==7 then set(":IN1","P1 Button 1",0); set(":IN0","P2 Button 1",0) end
  end
  if frame==6000 then
    local l={}
    for pc,n in pairs(pcs) do l[#l+1]={pc=pc,n=n} end
    table.sort(l,function(a,b) return a.n>b.n end)
    log:write("framebuffer writers by CURPC:"..NL)
    for i=1,math.min(#l,16) do log:write(string.format("  %06X  %d writes",l[i].pc,l[i].n)..NL) end
    log:flush(); manager.machine:exit()
  end
end)
