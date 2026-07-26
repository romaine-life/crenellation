-- Capture the build phase at frame resolution, moving the trackball between
-- placements so each dropped piece lands on clear ground and its shape can be
-- read from the diff.
local OUT="D:/repos/crenellation/romlab/out/pieces/"
local log=io.open(OUT.."p.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local frame=0; local dumps=0
local tx,ty=0,0
local function fld(p,n) local port=manager.machine.ioport.ports[p]; return port and port.fields[n] or nil end
local function set(p,n,v) local f=fld(p,n); if f then pcall(function() f:set_value(v) end) end end
emu.register_frame_done(function()
  frame=frame+1
  if frame>600 then
    local c=frame%240
    if c==0 then set(":IN1","Coin 1",1) end
    if c==20 then set(":IN1","Coin 1",0) end
  end
  -- Walk the cursor constantly and fire on a slower cadence, so consecutive
  -- pieces are dropped in different places.
  if frame>800 then
    tx=(tx+7)%256; ty=(ty+11)%256
    set(":TRACK3","Trackball X",tx)
    set(":TRACK2","Trackball Y",ty)
    local q=frame%45
    if q==0 then set(":IN1","P1 Button 1",1) end
    if q==6 then set(":IN1","P1 Button 1",0) end
  end
  -- Dump only while the countdown is in the 20s build window.
  if frame>3000 and dumps<260 then
    local ok,t=pcall(function() return space:read_u8(0x3E1870) end)
    if ok and t>0 and t<=20 and frame%3==0 then
      pcall(function()
        local bmp=manager.machine.memory.shares[":bitmap"]
        local buf={}
        for y=0,239 do
          local o=y*512
          for x=0,335 do buf[#buf+1]=string.char(bmp:read_u8(o+x)) end
        end
        local fh=io.open(string.format("%sf-%03d.bin",OUT,dumps),"wb"); fh:write(table.concat(buf)); fh:close()
        if dumps==0 then
          local pal=manager.machine.memory.shares[":palette"]
          local pt={} for i=0,pal.size-1 do pt[#pt+1]=string.char(pal:read_u8(i)) end
          fh=io.open(OUT.."pal.bin","wb"); fh:write(table.concat(pt)); fh:close()
        end
      end)
      dumps=dumps+1
    end
  end
  if dumps>=260 then log:write("dumps "..dumps..NL); log:flush(); manager.machine:exit() end
end)
