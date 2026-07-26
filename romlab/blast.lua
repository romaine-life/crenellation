-- Measure blast radius: dump the playfield every 5 frames through a battle,
-- so wall cells that vanish between frames can be clustered into single
-- explosion footprints.
local OUT="D:/repos/crenellation/romlab/out/blast/"
local log=io.open(OUT.."blast.log","w")
local NL=string.char(10)
local frame=0; local dumps=0
local function fld(p,n) local port=manager.machine.ioport.ports[p]; return port and port.fields[n] or nil end
local function set(p,n,v) local f=fld(p,n); if f then pcall(function() f:set_value(v) end) end end
emu.register_frame_done(function()
  frame=frame+1
  if frame>600 then
    local c=frame%240
    if c==0 then set(":IN1","Coin 1",1) end
    if c==20 then set(":IN1","Coin 1",0) end
    local q=frame%20
    if q==0 then set(":IN1","P1 Button 1",1); set(":IN0","P2 Button 1",1) end
    if q==6 then set(":IN1","P1 Button 1",0); set(":IN0","P2 Button 1",0) end
  end
  if frame>4000 and frame%5==0 and dumps<120 then
    pcall(function()
      local bmp=manager.machine.memory.shares[":bitmap"]
      local t={}
      -- visible rows only, to keep the dump small and fast
      for y=0,239 do
        local o=y*512
        for x=0,335 do t[#t+1]=string.char(bmp:read_u8(o+x)) end
      end
      local fh=io.open(string.format("%sf-%03d.bin",OUT,dumps),"wb"); fh:write(table.concat(t)); fh:close()
      if dumps==0 then
        local pal=manager.machine.memory.shares[":palette"]
        local pt={} for i=0,pal.size-1 do pt[#pt+1]=string.char(pal:read_u8(i)) end
        fh=io.open(OUT.."pal.bin","wb"); fh:write(table.concat(pt)); fh:close()
      end
    end)
    dumps=dumps+1
  end
  if dumps>=120 then log:write("dumps "..dumps..NL); log:flush(); manager.machine:exit() end
end)
