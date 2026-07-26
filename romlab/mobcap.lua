-- Capture everything needed to reproduce the motion-object (sprite) layer:
-- the display list, the graphics ROM, the palette, the playfield bitmap, and
-- the screen as the hardware actually rendered it. Whatever the composition
-- rules are, they must turn the first four into the fifth.
local OUT = "D:/repos/crenellation/romlab/out/mob/"
local log = io.open(OUT .. "mob.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local frame = 0
local tx, ty = 0, 0
local SHOTS = { 1500, 2000, 2600, 3200, 4000, 5000, 6200, 7400 }

local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end

local function dump_region(name, file)
  local r = manager.machine.memory.regions[name]
  if not r then log:write("no region "..name..NL); return end
  local t = {}
  for i = 0, r.size-1 do t[#t+1] = string.char(r:read_u8(i)) end
  local fh = io.open(OUT..file,"wb"); fh:write(table.concat(t)); fh:close()
end

local function dump_share(name, file)
  local s = manager.machine.memory.shares[name]
  if not s then log:write("no share "..name..NL); return end
  local t = {}
  for i = 0, s.size-1 do t[#t+1] = string.char(s:read_u8(i)) end
  local fh = io.open(OUT..file,"wb"); fh:write(table.concat(t)); fh:close()
end

local function capture(tag)
  dump_share(":mob", "mob-"..tag..".bin")
  dump_share(":mob:slip", "slip-"..tag..".bin")
  dump_share(":bitmap", "bmp-"..tag..".bin")
  dump_share(":palette", "pal-"..tag..".bin")
  local scr = manager.machine.screens[":screen"]
  local ok, px = pcall(function() return scr:pixels() end)
  if ok and px then
    local fh = io.open(OUT.."scr-"..tag..".bin","wb"); fh:write(px); fh:close()
    log:write(string.format("SHOT %s w=%d h=%d bytes=%d", tag,
      scr.width, scr.height, #px)..NL)
  else
    log:write("SHOT "..tag.." pixels() failed"..NL)
  end
  log:flush()
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 100 then dump_region(":gfx", "gfx.bin") end
  if frame > 600 and frame < 4000 then
    local c = frame % 240
    if c == 0 then set(":IN1","Coin 1",1) end
    if c == 20 then set(":IN1","Coin 1",0) end
    if c == 40 then set(":IN1","P1 Button 1",1) end
    if c == 50 then set(":IN1","P1 Button 1",0) end
  end
  if frame > 900 then
    tx=(tx+7)%256; ty=(ty+11)%256
    set(":TRACK3","Trackball X",tx); set(":TRACK2","Trackball Y",ty)
    local q = frame % 45
    if q == 0 then set(":IN1","P1 Button 1",1) end
    if q == 6 then set(":IN1","P1 Button 1",0) end
  end
  for _, f in ipairs(SHOTS) do if frame == f then capture(tostring(f)) end end
  if frame == 7600 then log:write("done"..NL); log:flush(); manager.machine:exit() end
end)
