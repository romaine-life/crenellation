-- Map sound ids to OKI samples: inject each id into the sound queue and log
-- which sample number the driver selects. The OKI takes 0x80|sample to latch a
-- phrase, so those writes name the effect.
local OUT="D:/repos/crenellation/romlab/out/sfxmap/"
local log=io.open(OUT.."map.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local Q_LO,Q_HI,WPTR=0x3E3D46,0x3E3D55,0x3E3D5A
local frame=0; local id=0; local cur={}
local SETTLE,WINDOW=30,90
local CYCLE=SETTLE+WINDOW
local START=3000
local function install()
  TAPS[#TAPS+1]=space:install_write_tap(0x460000,0x479fff,"oki",function(offset,data,mask)
    local v=(data>>8)&0xFF
    if v==0 then v=data&0xFF end
    if v>=0x80 and v<=0xFF then cur[v-0x80]=(cur[v-0x80] or 0)+1 end
    return data
  end)
end
local function queue(sid)
  pcall(function()
    local p=space:read_u32(WPTR); p=p+1
    if p>Q_HI or p<Q_LO then p=Q_LO end
    space:write_u32(WPTR,p); space:write_u8(p,sid)
  end)
end
emu.register_frame_done(function()
  frame=frame+1
  if frame==600 then install() end
  if frame<START then return end
  local t=(frame-START)%CYCLE
  if t==0 then cur={}
  elseif t==SETTLE then
    if id>255 then log:write("done"..NL); log:flush(); manager.machine:exit(); return end
    queue(id)
  elseif t==CYCLE-1 then
    local list={}
    for s,n in pairs(cur) do list[#list+1]=string.format("%d",s) end
    if #list>0 then
      table.sort(list)
      log:write(string.format("id %d -> samples %s",id,table.concat(list,","))..NL); log:flush()
    end
    id=id+1
  end
end)
