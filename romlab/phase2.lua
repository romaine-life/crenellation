-- Who writes the phase variable, and where is the score?
--
-- 0x3E195C holds the phase; tapping its writes names the state machine.
-- The player struct was found at 0x3E19E6 via player->0x24, so the score is
-- most likely a field inside it - sampling the struct over time and looking
-- for a field that only ever increases finds it without guessing.
local OUT = "D:/repos/crenellation/romlab/out/phase2/"
local log = io.open(OUT .. "p.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local frame, tx, ty = 0, 0, 0
local wr = {}
local samples = {}

local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end

local function install()
  TAPS[#TAPS+1] = space:install_write_tap(0x3E195C, 0x3E195D, "phase", function(o,d,m)
    local pc = cpu.state["CURPC"].value
    local k = string.format("%06X", pc)
    wr[k] = (wr[k] or 0) + 1
    return d
  end)
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 500 then install() end
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
  -- sample the player struct and the phase every 30 frames
  if frame > 1000 and frame % 30 == 0 then
    local p = space:read_u32(0x3E1960)
    if p >= 0x3E0000 and p <= 0x3EFF00 then
      local parts = {}
      for i = 0, 0x7E, 2 do parts[#parts+1] = string.format("%04X", space:read_u16(p+i)) end
      samples[#samples+1] = string.format("S %d %06X %d %d %s", frame, p,
        space:read_u8(0x3E195C), space:read_u8(0x3E1870), table.concat(parts))
    end
  end
  if frame == 12000 then
    for k,v in pairs(wr) do log:write(string.format("W %s %d", k, v)..NL) end
    for _,s in ipairs(samples) do log:write(s..NL) end
    log:write("done"..NL); log:flush(); manager.machine:exit()
  end
end)
