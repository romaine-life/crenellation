-- Find phase countdown timers: work-RAM bytes that decrement by 1 about once
-- per second while a game runs. Those are the real phase durations.
local OUT="D:/repos/crenellation/romlab/out/timers/"
local log=io.open(OUT.."timers.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local frame=0
local hist={}   -- addr -> {last=v, lastframe=f, steps={}}
local function install()
  TAPS[#TAPS+1]=space:install_write_tap(0x3E0000,0x3E3FFF,"ram",function(offset,data,mask)
    local v=data & 0xFF
    local h=hist[offset]
    if h then
      if v==h.last-1 then
        local dt=frame-h.lastframe
        if dt>30 and dt<120 then h.steps[#h.steps+1]=dt end
        h.last=v; h.lastframe=frame
      elseif v>h.last then
        h.last=v; h.lastframe=frame; h.top=v
      else
        h.last=v; h.lastframe=frame
      end
    else
      hist[offset]={last=v,lastframe=frame,steps={},top=v}
    end
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
  if frame==20000 then
    local rows={}
    for a,h in pairs(hist) do
      if #h.steps>=4 then
        local s=0
        for _,d in ipairs(h.steps) do s=s+d end
        rows[#rows+1]={a=a,n=#h.steps,avg=s/#h.steps,top=h.top}
      end
    end
    table.sort(rows,function(x,y) return y.n<x.n end)
    log:write("RAM bytes counting down (addr, decrements, avg frames per step, highest value seen):"..NL)
    for i=1,math.min(#rows,25) do
      local r=rows[i]
      log:write(string.format("   %06X  %3d decrements  %.1f frames/step  max=%d",r.a,r.n,r.avg,r.top)..NL)
    end
    log:flush(); manager.machine:exit()
  end
end)
