-- Work-RAM access during the attract DEMO (no coin), excluding the sound
-- driver and the stack. The demo plays a real game, so game-logic routines
-- run here that never execute under bot play.
local OUT="D:/repos/crenellation/romlab/out/attractram/"
local log=io.open(OUT.."r.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local frame=0
local rd={}
local function install()
  TAPS[#TAPS+1]=space:install_read_tap(0x3E0000,0x3E3FFF,"r",function(offset,data,mask)
    local pc=cpu.state["CURPC"].value
    if pc>=0x1A000 and pc<0x1C400 then return data end        -- sound driver
    if offset>=0x3E3200 and offset<=0x3E3320 then return data end -- stack
    local e=rd[pc]
    if e then
      e.n=e.n+1
      if offset<e.lo then e.lo=offset end
      if offset>e.hi then e.hi=offset end
    else rd[pc]={n=1,lo=offset,hi=offset} end
    return data
  end)
end
emu.register_frame_done(function()
  frame=frame+1
  if frame==400 then install() end
  if frame==20000 then
    local l={}
    for pc,e in pairs(rd) do
      local span=e.hi-e.lo+1
      if e.n>2000 and span>=32 then l[#l+1]={pc=pc,n=e.n,lo=e.lo,hi=e.hi,span=span} end
    end
    table.sort(l,function(a,b) return a.n>b.n end)
    log:write("work-RAM readers during the attract demo:"..NL)
    for i=1,math.min(#l,24) do
      log:write(string.format("  CURPC %06X  %8d reads  %06X-%06X (%d bytes)",l[i].pc,l[i].n,l[i].lo,l[i].hi,l[i].span)..NL)
    end
    log:flush(); manager.machine:exit()
  end
end)
