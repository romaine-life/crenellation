-- Find the score in work RAM (a value that only ever increases during play,
-- in round numbers), and time how often ships fire.
local OUT="D:/repos/crenellation/romlab/out/score/"
local log=io.open(OUT.."score.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local frame=0
local cand={}   -- addr -> {last, ups, downs, maxdelta}
local fires={}  -- frames when the fire cue was queued
local function install()
  TAPS[#TAPS+1]=space:install_write_tap(0x3E0000,0x3E3FFF,"ram",function(offset,data,mask)
    if (offset % 2)==0 then
      local v=data & 0xFFFF
      local c=cand[offset]
      if c then
        if v>c.last then c.ups=c.ups+1; c.d=math.max(c.d, v-c.last)
        elseif v<c.last then c.downs=c.downs+1 end
        c.last=v
      else cand[offset]={last=v,ups=0,downs=0,d=0} end
    end
    return data
  end)
  -- sound id 94 was measured as the launch cue
  TAPS[#TAPS+1]=space:install_write_tap(0x3E3D46,0x3E3D55,"q",function(offset,data,mask)
    if (data & 0xFF)==94 then fires[#fires+1]=frame end
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
  if frame==26000 then
    local rows={}
    for a,c in pairs(cand) do
      if c.ups>=6 and c.downs==0 and c.last>0 then rows[#rows+1]={a=a,ups=c.ups,last=c.last,d=c.d} end
    end
    table.sort(rows,function(x,y) return y.ups<x.ups end)
    log:write("monotonically increasing words (score candidates):"..NL)
    for i=1,math.min(#rows,15) do
      log:write(string.format("   %06X ups=%d final=%d maxstep=%d",rows[i].a,rows[i].ups,rows[i].last,rows[i].d)..NL)
    end
    log:write(NL.."fire cues: "..#fires..NL)
    local gaps={}
    for i=2,#fires do gaps[#gaps+1]=fires[i]-fires[i-1] end
    table.sort(gaps)
    if #gaps>0 then
      log:write(string.format("fire gap median %d frames, min %d, max %d",gaps[math.floor(#gaps/2)+1],gaps[1],gaps[#gaps])..NL)
    end
    log:flush(); manager.machine:exit()
  end
end)
