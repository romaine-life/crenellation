-- Read the blast scripts straight out of the live level state.
-- No call needed: the descriptor pointer is at 0x3E0DCA and each player's
-- selector is the byte at +3, so the script pointer is
-- *(desc + 0x22 + sel*4). Sampling that while a level is up gives the real
-- data the verified selector would pick.
local OUT = "D:/repos/crenellation/romlab/out/blast4/"
local log = io.open(OUT .. "b.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local frame, tx, ty = 0, 0, 0
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
  if frame > 1500 and frame % 120 == 0 then
    local desc = space:read_u32(0x3E0DCA)
    if desc >= 0x400 and desc < 0x100000 then
      for i = 0, 2 do
        local pl = 0x3E1968 + i*0x7E
        local sel = space:read_u8(pl + 3)
        local ptr = space:read_u32(desc + 0x22 + sel*4)
        local key = string.format("%06X:%02X:%06X", desc, sel, ptr)
        if not seen[key] then
          seen[key] = true
          local parts = {}
          if ptr >= 0x400 and ptr < 0x100000 then
            for k = 0, 79 do parts[#parts+1] = string.format("%02X", space:read_u8(ptr + k)) end
          end
          log:write(string.format("P %d p%d desc %06X sel %02X ptr %08X %s",
            frame, i, desc, sel, ptr, table.concat(parts))..NL)
          log:flush()
        end
      end
    end
  end
  if frame == 9000 then log:write("done"..NL); log:flush(); manager.machine:exit() end
end)
