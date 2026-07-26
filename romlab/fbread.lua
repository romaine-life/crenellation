-- Which routines READ the playfield bitmap during a game?
--
-- Rampart keeps no board array in work RAM, so the wall layout lives in the
-- bitmap itself and the enclosure test must read it back. Writes to the bitmap
-- are constant; reads are rare and belong to the few routines that inspect the
-- battlefield. Record the reading instruction (CURPC, not PC) with the frame,
-- so a burst can be lined up against the end of the build phase.
local OUT = "D:/repos/crenellation/romlab/out/fbread/"
local log = io.open(OUT .. "r.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local frame, tx, ty = 0, 0, 0
local perframe = {}

local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end

local function install()
  TAPS[#TAPS+1] = space:install_read_tap(0x200000, 0x21FFFF, "fb", function(offset, data, mask)
    local pc = cpu.state["CURPC"].value
    local e = perframe[pc]
    if e then perframe[pc] = e + 1 else perframe[pc] = 1 end
    return data
  end)
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 500 then install() end
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
  -- log per-frame reader activity plus the countdown, so bursts can be placed
  if frame > 500 then
    local any = false
    for pc, n in pairs(perframe) do
      if n > 200 then
        log:write(string.format("F %d %06X %d %d", frame, pc, n, space:read_u8(0x3E1870))..NL)
        any = true
      end
    end
    if any then log:flush() end
    perframe = {}
  end
  if frame == 9600 then log:write("done"..NL); log:flush(); manager.machine:exit() end
end)
