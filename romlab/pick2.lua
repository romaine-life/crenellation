-- Who writes player->0x24, the current-piece pointer?
-- The damage routine showed the player structs are an array at 0x3E1968 with
-- stride 0x7E, so all four +0x24 fields can be tapped directly rather than
-- chasing whichever struct 0x3E1960 happens to point at.
local OUT = "D:/repos/crenellation/romlab/out/pick2/"
local log = io.open(OUT .. "p.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local frame, tx, ty = 0, 0, 0
local hits = {}
local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end
local function install()
  for i = 0, 3 do
    local a = 0x3E1968 + i*0x7E + 0x24
    TAPS[#TAPS+1] = space:install_write_tap(a, a+3, "p"..i, function(o,d,m)
      local pc = cpu.state["CURPC"].value
      local k = string.format("%d:%06X", i, pc)
      hits[k] = (hits[k] or 0) + 1
      return d
    end)
  end
  log:write("taps installed"..NL); log:flush()
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
  if frame == 9000 then
    for k,v in pairs(hits) do log:write(string.format("W %s %d", k, v)..NL) end
    log:write("done"..NL); log:flush(); manager.machine:exit()
  end
end)
