-- Dump work RAM alongside the playfield during a live level, so RAM contents
-- can be correlated against the known terrain grid.
local OUT = "D:/repos/crenellation/romlab/out/ram/"
local log = io.open(OUT .. "ram.log", "w")
local frame, dumps = 0, 0
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]

local function fld(p,n) local port=manager.machine.ioport.ports[p]; return port and port.fields[n] or nil end
local coin,fire,fire2
local function set(f,v) if f then pcall(function() f:set_value(v) end) end end

local function dump()
  pcall(function()
    local bmp = manager.machine.memory.shares[":bitmap"]
    local pal = manager.machine.memory.shares[":palette"]
    local t={} for i=0,bmp.size-1 do t[#t+1]=string.char(bmp:read_u8(i)) end
    local fh=io.open(string.format("%sbitmap-%02d.bin",OUT,dumps),"wb"); fh:write(table.concat(t)); fh:close()
    local pt={} for i=0,pal.size-1 do pt[#pt+1]=string.char(pal:read_u8(i)) end
    fh=io.open(string.format("%spalette-%02d.bin",OUT,dumps),"wb"); fh:write(table.concat(pt)); fh:close()
    local rt={} for a=0x3E0000,0x3E3FFF do rt[#rt+1]=string.char(space:read_u8(a)) end
    fh=io.open(string.format("%sram-%02d.bin",OUT,dumps),"wb"); fh:write(table.concat(rt)); fh:close()
    log:write(string.format("frame %d dump %02d\n",frame,dumps)); log:flush()
    dumps=dumps+1
  end)
end

emu.register_frame_done(function()
  frame=frame+1
  if frame==300 then coin=fld(":IN1","Coin 1"); fire=fld(":IN1","P1 Button 1"); fire2=fld(":IN0","P2 Button 1") end
  if frame>300 then
    local c=frame%240
    if c==0 then set(coin,1) end
    if c==20 then set(coin,0) end
    local q=frame%30
    if q==0 then set(fire,1); set(fire2,1) end
    if q==8 then set(fire,0); set(fire2,0) end
  end
  if frame>2500 and frame%400==0 and dumps<6 then dump() end
  if dumps>=6 or frame>9000 then manager.machine:exit() end
end)
