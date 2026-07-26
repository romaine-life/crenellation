-- Capture piece shape scripts.
--
-- 0x8B4 walks a piece as a byte script of direction indices. Its callers pass
-- *(player->0x24) + 1, so the current piece's script is reachable from the
-- player struct at 0x3E1960 every frame of the build phase. Logging the
-- pointer and the bytes behind it enumerates the shape table.
local OUT = "D:/repos/crenellation/romlab/out/pieces2/"
local log = io.open(OUT .. "p.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local frame, tx, ty = 0, 0, 0
local seen = {}
local n = 0

local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end

emu.register_frame_done(function()
  frame = frame + 1
  if frame > 600 and frame < 9000 then
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
  if frame > 950 then
    local ok = pcall(function()
      local p = space:read_u32(0x3E1960)
      if p < 0x3E0000 or p > 0x3EFFFF then return end
      local q = space:read_u32(p + 0x24)
      if q < 0x000000 or q > 0x3EFFFF then return end
      local s = space:read_u32(q)
      if s < 0x000400 or s > 0x0FFFFF then return end
      if not seen[s] then
        seen[s] = true
        n = n + 1
        local b = {}
        for i = 0, 39 do b[#b+1] = string.format("%02X", space:read_u8(s + i)) end
        log:write(string.format("S %06X %d %s", s, frame, table.concat(b))..NL)
        log:flush()
      end
    end)
  end
  if frame == 12000 then log:write("scripts "..n..NL); log:flush(); manager.machine:exit() end
end)
