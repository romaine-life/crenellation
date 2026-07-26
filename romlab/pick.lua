-- Who chooses the piece?
--
-- The walker reads *(player->0x24). Tapping writes to that field, and to the
-- word it points at, names the routine that selects a piece - and CURPC gives
-- the exact instruction.
local OUT = "D:/repos/crenellation/romlab/out/pick/"
local log = io.open(OUT .. "p.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local frame, tx, ty = 0, 0, 0
local armed = false
local hits = {}

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
  if not armed and frame > 1200 then
    local p = space:read_u32(0x3E1960)
    if p >= 0x3E0000 and p <= 0x3EFFFF then
      local q = space:read_u32(p + 0x24)
      log:write(string.format("player %06X  field24 -> %06X", p, q)..NL)
      -- tap the field itself and the cell it points at
      TAPS[#TAPS+1] = space:install_write_tap(p+0x24, p+0x27, "f24", function(o,d,m)
        local pc = cpu.state["CURPC"].value
        hits["f24:"..string.format("%06X",pc)] = (hits["f24:"..string.format("%06X",pc)] or 0) + 1
        return d
      end)
      if q >= 0x3E0000 and q <= 0x3EFFFF then
        TAPS[#TAPS+1] = space:install_write_tap(q, q+3, "ptr", function(o,d,m)
          local pc = cpu.state["CURPC"].value
          local k = "ptr:"..string.format("%06X",pc)
          hits[k] = (hits[k] or 0) + 1
          return d
        end)
      end
      armed = true
      log:flush()
    end
  end
  if frame == 9000 then
    for k,v in pairs(hits) do log:write(string.format("%s %d", k, v)..NL) end
    log:write("done"..NL); log:flush(); manager.machine:exit()
  end
end)
