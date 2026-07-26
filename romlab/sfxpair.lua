-- Map sound ids to OKI samples by watching normal play: when an id is queued
-- and the OKI latches a phrase within a few frames, that is the effect.
local OUT="D:/repos/crenellation/romlab/out/sfxmap/"
local log=io.open(OUT.."pairs.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local frame=0
local recent={}
local function install()
  TAPS[#TAPS+1]=space:install_write_tap(0x3E3D46,0x3E3D55,"q",function(offset,data,mask)
    local v=data & 0xFF
    if v>0 then recent[#recent+1]={id=v,f=frame} end
    if #recent>40 then table.remove(recent,1) end
    return data
  end)
  TAPS[#TAPS+1]=space:install_write_tap(0x460000,0x479fff,"oki",function(offset,data,mask)
    local v=data & 0xFF
    if v>=0x80 then
      -- attribute to the most recent queued id within 8 frames
      for i=#recent,1,-1 do
        if frame-recent[i].f<=8 then
          log:write(string.format("id %d sample %d",recent[i].id,v-0x80)..NL); log:flush()
          break
        end
      end
    end
    return data
  end)
end
local function fld(p,n) local port=manager.machine.ioport.ports[p]; return port and port.fields[n] or nil end
local function set(p,n,v) local f=fld(p,n); if f then pcall(function() f:set_value(v) end) end end
emu.register_frame_done(function()
  frame=frame+1
  if frame==900 then install() end
  if frame>600 then
    local c=frame%240
    if c==0 then set(":IN1","Coin 1",1) end
    if c==20 then set(":IN1","Coin 1",0) end
    local q=frame%25
    if q==0 then set(":IN1","P1 Button 1",1); set(":IN0","P2 Button 1",1) end
    if q==7 then set(":IN1","P1 Button 1",0); set(":IN0","P2 Button 1",0) end
  end
  if frame==20000 then manager.machine:exit() end
end)
