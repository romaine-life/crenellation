-- Capture the real blast scripts.
-- Deriving the table address gave values outside the board's range, so instead
-- watch what the verified handler actually reads: 0x8598 parks a cursor at
-- player+0x3E before queueing 0x8606. Tapping that field and dumping the bytes
-- it points at gives the scripts as the game uses them.
local OUT = "D:/repos/crenellation/romlab/out/blastcap/"
local log = io.open(OUT .. "b.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local frame, tx, ty, n = 0, 0, 0, 0
local seen = {}
local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end
emu.register_frame_done(function()
  frame = frame + 1
  if frame == 700 then
    for i = 0, 2 do
      local a = 0x3E1968 + i*0x7E + 0x3E
      TAPS[#TAPS+1] = space:install_write_tap(a, a+3, "c"..i, function(o,d,m)
        return d
      end)
    end
    log:write("armed"..NL); log:flush()
  end
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
  -- poll the cursor field each frame; when it points somewhere new, dump it
  if frame > 900 then
    for i = 0, 2 do
      local pl = 0x3E1968 + i*0x7E
      local cur = space:read_u32(pl + 0x3E)
      if cur >= 0x400 and cur < 0x100000 and not seen[cur] then
        seen[cur] = true
        n = n + 1
        local parts = {}
        for k = 0, 47 do parts[#parts+1] = string.format("%02X", space:read_u8(cur + k)) end
        log:write(string.format("C %d %d %06X sel %02X %s", frame, i, cur,
          space:read_u8(pl + 0x1D), table.concat(parts))..NL)
        log:flush()
      end
    end
  end
  if frame == 9000 then log:write("cursors "..n..NL); log:flush(); manager.machine:exit() end
end)
