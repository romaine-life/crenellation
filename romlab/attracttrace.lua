-- The bot never seals a castle, so the enclosure path may never run in my
-- traces. The attract-mode demo DOES enclose (it shows claimed territory), so
-- trace with no coin inserted at all.
local OUT="D:/repos/crenellation/romlab/out/attracttrace/"
local log=io.open(OUT.."a.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local frame=0
local rd={}
local function install()
  TAPS[#TAPS+1]=space:install_read_tap(0x200000,0x21FFFF,"fb",function(offset,data,mask)
    local pc=cpu.state["CURPC"].value
    local e=rd[pc]
    if e then e.n=e.n+1; if offset<e.lo then e.lo=offset end; if offset>e.hi then e.hi=offset end
    else rd[pc]={n=1,lo=offset,hi=offset} end
    return data
  end)
end
emu.register_frame_done(function()
  frame=frame+1
  if frame==400 then install() end
  if frame==20000 then
    local l={}
    for pc,e in pairs(rd) do l[#l+1]={pc=pc,n=e.n,lo=e.lo,hi=e.hi} end
    table.sort(l,function(a,b) return a.n>b.n end)
    log:write("framebuffer readers during the attract demo:"..NL)
    for i=1,math.min(#l,20) do
      log:write(string.format("  CURPC %06X  %8d reads  %06X-%06X",l[i].pc,l[i].n,l[i].lo,l[i].hi)..NL)
    end
    log:flush(); manager.machine:exit()
  end
end)
