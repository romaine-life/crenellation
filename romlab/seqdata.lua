local OUT="D:/repos/crenellation/romlab/out/song/"
local log=io.open(OUT.."seqdata.log","w")
local NL=string.char(10)
local frame=0
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local reads={}
local pcs={}
local function install()
  TAPS[#TAPS+1]=space:install_read_tap(0x020000,0x0FFFFF,"r",function(offset,data,mask)
    local pc=cpu.state["PC"].value
    -- only the sound driver's own code
    if pc>=0x1A000 and pc<0x1C400 then
      local b=offset-(offset%0x100)
      reads[b]=(reads[b] or 0)+1
      pcs[pc]=(pcs[pc] or 0)+1
    end
    return data
  end)
  log:write("tap installed"..NL); log:flush()
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
    local q=frame%30
    if q==0 then set(":IN1","P1 Button 1",1); set(":IN0","P2 Button 1",1) end
    if q==8 then set(":IN1","P1 Button 1",0); set(":IN0","P2 Button 1",0) end
  end
  if frame==5000 then
    local a={}
    for b,n in pairs(reads) do a[#a+1]={b=b,n=n} end
    table.sort(a,function(x,y) return x.b<y.b end)
    local runs={}
    for _,e in ipairs(a) do
      local last=runs[#runs]
      if last and e.b==last.hi+0x100 then last.hi=e.b; last.n=last.n+e.n
      else runs[#runs+1]={lo=e.b,hi=e.b,n=e.n} end
    end
    log:write(NL.."ROM regions read by the sound driver:"..NL)
    for _,r in ipairs(runs) do
      log:write(string.format("   %06X-%06X  %d reads",r.lo,r.hi+0xFF,r.n)..NL)
    end
    local p={}
    for pc,n in pairs(pcs) do p[#p+1]={pc=pc,n=n} end
    table.sort(p,function(x,y) return y.n<x.n end)
    log:write(NL.."reading PCs:"..NL)
    for i=1,math.min(#p,8) do log:write(string.format("   PC %06X  %d",p[i].pc,p[i].n)..NL) end
    log:flush(); manager.machine:exit()
  end
end)
