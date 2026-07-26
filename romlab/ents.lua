-- Who moves entities?
-- The shot physics was found by tapping the ring it writes. Ships are entities,
-- so tapping the entity table at 0x3E02D8 and recording (instruction, offset)
-- should name every routine that moves one.
local OUT = "D:/repos/crenellation/romlab/out/ents/"
local log = io.open(OUT .. "e.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local frame, tx, ty = 0, 0, 0
local hits = {}
local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end
emu.register_frame_done(function()
  frame = frame + 1
  if frame == 700 then
    TAPS[#TAPS+1] = space:install_write_tap(0x3E02D8, 0x3E02D8 + 16*80 - 1, "e",
      function(o,d,m)
        local pc = cpu.state["CURPC"].value
        local off = (o - 0x3E02D8) % 16
        local k = string.format("%06X off%02X", pc, off)
        hits[k] = (hits[k] or 0) + 1
        return d
      end)
    log:write("tap installed"..NL); log:flush()
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
  if frame == 9000 then
    local n=0
    for k,v in pairs(hits) do log:write(string.format("W %s %d", k, v)..NL); n=n+1 end
    log:write("entries "..n..NL); log:flush(); manager.machine:exit()
  end
end)
