-- Read the real blast scripts.
-- 0x8598 acts on any player whose word0 has bit 0x8000 set. Setting that bit
-- during a live game makes the game select a script itself, using the real
-- level descriptor - then the cursor it parks at player+0x3E points at the
-- actual coordinate data.
local OUT = "D:/repos/crenellation/romlab/out/blast2/"
local log = io.open(OUT .. "b.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local frame, tx, ty, n = 0, 0, 0, 0
local seen = {}
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
  -- once a level is up, flag each player in turn so the game picks a script
  if frame > 2000 and frame % 60 == 0 then
    local i = (frame // 60) % 3
    local pl = 0x3E1968 + i*0x7E
    local w = space:read_u16(pl)
    space:write_u16(pl, w | 0x8000)
    -- vary the sub-list selector so several patterns get chosen
    space:write_u8(pl + 0x1D, (frame // 180) % 6)
  end
  if frame > 2000 then
    local desc = space:read_u32(0x3E0DCA)
    for i = 0, 2 do
      local pl = 0x3E1968 + i*0x7E
      local cur = space:read_u32(pl + 0x3E)
      if cur >= 0x400 and cur < 0x100000 and not seen[cur] then
        seen[cur] = true; n = n + 1
        local parts = {}
        for k = 0, 63 do parts[#parts+1] = string.format("%02X", space:read_u8(cur + k)) end
        log:write(string.format("C %d p%d desc %06X sel %02X skip %02X cur %06X %s",
          frame, i, desc, space:read_u8(pl+3), space:read_u8(pl+0x1D), cur,
          table.concat(parts))..NL)
        log:flush()
      end
    end
  end
  if frame == 9000 then log:write("cursors "..n..NL); log:flush(); manager.machine:exit() end
end)
