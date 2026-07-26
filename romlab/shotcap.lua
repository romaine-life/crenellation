-- Sample live shot records every frame.
-- Rather than call the long update routine in isolation, capture the state of
-- each shot as the game flies it. The port must turn frame N's record into
-- frame N+1's exactly - which tests the integration against real trajectories
-- instead of invented ones.
local OUT = "D:/repos/crenellation/romlab/out/shotcap/"
local log = io.open(OUT .. "s.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local frame, tx, ty, n = 0, 0, 0, 0
local RINGS = {0x3E0F48, 0x3E1254, 0x3E1560}
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
  if frame > 1200 and n < 40000 then
    for r = 1, 3 do
      local base = RINGS[r]
      for s = 0, 7 do
        local rec = base + s*0x1A
        local ent = space:read_u32(rec + 0x16)
        if ent ~= 0 then
          log:write(string.format("R %d %d %d %04X %04X %04X %04X %04X %04X %08X",
            frame, r, s,
            space:read_u16(rec+0x06), space:read_u16(rec+0x08),
            space:read_u16(rec+0x0A), space:read_u16(rec+0x0C),
            space:read_u16(rec+0x0E), space:read_u16(rec+0x10), ent)..NL)
          n = n + 1
        end
      end
    end
  end
  if frame == 9000 then log:write("rows "..n..NL); log:flush(); manager.machine:exit() end
end)
