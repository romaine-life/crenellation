local OUT="D:/repos/crenellation/romlab/out/board/"
local log=io.open(OUT.."board.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local frame=0; local dumps=0
local LO,HI=0x3E0F00,0x3E1900
local function fld(p,n) local port=manager.machine.ioport.ports[p]; return port and port.fields[n] or nil end
local function set(p,n,v) local f=fld(p,n); if f then pcall(function() f:set_value(v) end) end end
emu.register_frame_done(function()
  frame=frame+1
  if frame>600 then
    local c=frame%240
    if c==0 then set(":IN1","Coin 1",1) end
    if c==20 then set(":IN1","Coin 1",0) end
    local q=frame%25
    if q==0 then set(":IN1","P1 Button 1",1); set(":IN0","P2 Button 1",1) end
    if q==7 then set(":IN1","P1 Button 1",0); set(":IN0","P2 Button 1",0) end
  end
  if frame>4000 and frame%700==0 and dumps<6 then
    local t={}
    for a=LO,HI-1 do t[#t+1]=string.char(space:read_u8(a)) end
    local fh=io.open(string.format("%sram-%d.bin",OUT,dumps),"wb"); fh:write(table.concat(t)); fh:close()
    -- framebuffer alongside, to correlate
    local bmp=manager.machine.memory.shares[":bitmap"]
    local b={}
    for i=0,bmp.size-1 do b[#b+1]=string.char(bmp:read_u8(i)) end
    fh=io.open(string.format("%sbmp-%d.bin",OUT,dumps),"wb"); fh:write(table.concat(b)); fh:close()
    if dumps==0 then
      local pal=manager.machine.memory.shares[":palette"]
      local pt={} for i=0,pal.size-1 do pt[#pt+1]=string.char(pal:read_u8(i)) end
      fh=io.open(OUT.."pal.bin","wb"); fh:write(table.concat(pt)); fh:close()
    end
    log:write("dump "..dumps.." frame "..frame..NL); log:flush()
    dumps=dumps+1
  end
  if dumps>=6 then manager.machine:exit() end
end)
