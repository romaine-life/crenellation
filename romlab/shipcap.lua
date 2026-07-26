-- Sample the moving-unit records every frame.
-- 0xAF72 steps 7 records of 0x12 bytes at 0x3E1BC6: position in 1/32 units at
-- +0xA/+0xC advanced by velocity at +0xE/+0x10, a lifetime counter at +8, and
-- the sprite at +4 receiving (x >> 5, y >> 5).
local OUT = "D:/repos/crenellation/romlab/out/shipcap/"
local log = io.open(OUT .. "s.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local frame, tx, ty, n = 0, 0, 0, 0
local BASE, STRIDE, COUNT = 0x3E1BC6, 0x12, 7
local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end
emu.register_frame_done(function()
  frame = frame + 1
  if frame > 600 and frame < 12000 then
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
  if frame > 1000 and n < 40000 then
    for s = 0, COUNT-1 do
      local r = BASE + s*STRIDE
      local ent = space:read_u32(r + 4)
      if ent ~= 0 then
        log:write(string.format("U %d %d %08X %04X %04X %04X %04X %04X",
          frame, s, ent,
          space:read_u16(r+0x08), space:read_u16(r+0x0A), space:read_u16(r+0x0C),
          space:read_u16(r+0x0E), space:read_u16(r+0x10))..NL)
        n = n + 1
      end
    end
  end
  if frame == 9000 then log:write("rows "..n..NL); log:flush(); manager.machine:exit() end
end)
