-- Differential: identical sessions, one with a sealed wall stamped and one
-- without. The game is deterministic given identical inputs, so any work-RAM
-- cell that ends up different between the two runs is downstream of the
-- enclosure - which is where the score has to be.
local STAMP = true
local OUT = "D:/repos/crenellation/romlab/out/score6/"
local TAG = STAMP and "a" or "b"
local log = io.open(OUT .. "s" .. TAG .. ".log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local BOARD = 0x3E0864
local frame, tx, ty = 0, 0, 0
local stamped = false
local prev_cd = -1
local shots = 0

local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end
local function cell(x,y) return BOARD + x*32 + y end

local function snap(tag)
  local t = {}
  for a = 0x3E0000, 0x3EFFFF, 2 do
    local v = space:read_u16(a)
    t[#t+1] = string.char(math.floor(v/256)%256, v%256)
  end
  local fh = io.open(OUT.."ram-"..TAG.."-"..tag..".bin","wb"); fh:write(table.concat(t)); fh:close()
  log:write("SNAP "..tag.." frame "..frame..NL); log:flush()
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
  if frame == 2039 then
    if STAMP then
      -- seal around a real castle (type 0x02 at cols 19-20, rows 17-18) -
      -- Rampart scores territory that CONTAINS a castle, so enclosing bare
      -- ground is not a scoring event
      for x = 17, 22 do space:write_u8(cell(x,15), 0x41); space:write_u8(cell(x,20), 0x41) end
      for y = 15, 20 do space:write_u8(cell(17,y), 0x41); space:write_u8(cell(22,y), 0x41) end
    end
    snap("pre")
  end
  if frame == 3093 then snap("at") end
  if frame == 3200 then snap("post") end
  if frame == 3400 then snap("late"); log:write("done"..NL); log:flush(); manager.machine:exit() end
end)
