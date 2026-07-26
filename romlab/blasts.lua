-- Extract the blast scripts.
-- 0x8598 reaches them through 0x3E0DCA + 0x22 + index*4; each is a list of
-- packed (x,y) words ending on a negative high byte. The verified handler
-- 0x8606 consumes one entry per call, so these lists are the damage patterns.
local OUT = "D:/repos/crenellation/romlab/out/blasts/"
local log = io.open(OUT .. "b.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local frame, tx, ty = 0, 0, 0
local dumped = false
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
  if frame >= 3000 and not dumped then
    local base = space:read_u32(0x3E0DCA)
    log:write(string.format("base %08X", base)..NL)
    if base >= 0x400 and base <= 0x3EFFFF then
      for i = 0, 15 do
        local ptr = space:read_u32(base + 0x22 + i*4)
        if ptr >= 0x400 and ptr <= 0x3EFFFF then
          local parts = {}
          local p = ptr
          for k = 0, 63 do
            local hi = space:read_u8(p)
            local lo = space:read_u8(p+1)
            parts[#parts+1] = string.format("%02X%02X", hi, lo)
            if hi >= 0x80 then break end
            p = p + 2
          end
          log:write(string.format("S %d %08X %s", i, ptr, table.concat(parts, " "))..NL)
        else
          log:write(string.format("S %d %08X (out of range)", i, ptr)..NL)
        end
      end
      dumped = true
      log:flush()
    end
  end
  if frame == 4000 then log:write("done"..NL); log:flush(); manager.machine:exit() end
end)
