-- Force a scoring event and watch what it pays.
--
-- The bot never seals a castle by accident, so the scoring routine never runs
-- during capture. The board layout is known and the enclosure test is verified,
-- so a sealed wall can simply be written onto the board - then the transition
-- must score it. Tapping work RAM across those few frames records every write
-- with the instruction that made it.
local OUT = "D:/repos/crenellation/romlab/out/score4/"
local log = io.open(OUT .. "s.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local BOARD = 0x3E0864
local frame, tx, ty = 0, 0, 0
local stamped, tracing, tapobj = false, 0, nil
local prev_cd = -1
local writes = {}

local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end
local function cell(x,y) return BOARD + x*32 + y end

-- find the player's own wall colour by sampling what is already on the board
local function owner_code()
  for i = 0, 42*32-1 do
    local v = space:read_u8(BOARD + i)
    if v ~= 0 and (v % 64) == 1 then return v - 1 end
  end
  return 0x40
end

local function stamp()
  local own = owner_code()
  local wall = own + 1
  -- a sealed rectangle in clear ground
  for x = 4, 13 do space:write_u8(cell(x,4), wall); space:write_u8(cell(x,13), wall) end
  for y = 4, 13 do space:write_u8(cell(4,y), wall); space:write_u8(cell(13,y), wall) end
  log:write(string.format("stamped owner %02X at frame %d", own, frame)..NL); log:flush()
end

local function tap_on()
  writes = {}
  tapobj = space:install_write_tap(0x3E0000, 0x3EFFFF, "w", function(o,d,m)
    local pc = cpu.state["CURPC"].value
    local k = string.format("%06X:%06X", o, pc)
    local e = writes[k]
    if e then e.n = e.n + 1; e.last = d
    else writes[k] = { n = 1, first = d, last = d } end
    return d
  end)
end
local function tap_off()
  if tapobj then tapobj:remove(); tapobj = nil end
  local n = 0
  for k, e in pairs(writes) do
    log:write(string.format("W %s %d %08X %08X", k, e.n, e.first % 0x100000000, e.last % 0x100000000)..NL)
    n = n + 1
  end
  log:write("# writes "..n..NL); log:flush()
end

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

  if tracing > 0 then
    tracing = tracing - 1
    if tracing == 0 then tap_off(); log:write("done"..NL); log:flush(); manager.machine:exit() end
    return
  end

  local cd = space:read_u8(0x3E1870)
  -- stamp partway through a build countdown
  if not stamped and frame > 2000 and cd >= 6 and cd <= 10 then
    stamp(); stamped = true
  end
  -- trace the transition
  if stamped and prev_cd == 1 and cd == 0 then
    tap_on(); tracing = 5
    log:write("trace at frame "..frame..NL); log:flush()
  end
  prev_cd = cd
  if frame == 12000 then log:write("timeout"..NL); log:flush(); manager.machine:exit() end
end)
