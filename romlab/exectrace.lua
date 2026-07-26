-- Record every address the CPU actually executes in the overlay.
-- Static analysis cannot follow jump tables or stored function pointers, so
-- neither the linear sweep nor recursive traversal reaches everything. The
-- emulator can: tap instruction fetches in short windows spread across a long
-- session covering attract, build and battle, and the union is ground truth
-- for which bytes are code.
local OUT = "D:/repos/crenellation/romlab/out/exec/"
local log = io.open(OUT .. "e.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local hit = {}
local tap = nil
local frame, tx, ty = 0, 0, 0
local windows = 0

local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end

local function tap_on()
  tap = space:install_read_tap(0x000000, 0x01FFFF, "x", function(offset, data, mask)
    hit[cpu.state["CURPC"].value] = true
    return data
  end)
end
local function tap_off()
  if tap then tap:remove(); tap = nil end
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame > 300 and frame < 14000 then
    local c = frame % 240
    if c == 0 then set(":IN1","Coin 1",1) end
    if c == 20 then set(":IN1","Coin 1",0) end
    if c == 40 then set(":IN1","P1 Button 1",1) end
    if c == 50 then set(":IN1","P1 Button 1",0) end
  end
  if frame > 500 then
    tx=(tx+7)%256; ty=(ty+11)%256
    set(":TRACK3","Trackball X",tx); set(":TRACK2","Trackball Y",ty)
    local q = frame % 45
    if q == 0 then set(":IN1","P1 Button 1",1) end
    if q == 6 then set(":IN1","P1 Button 1",0) end
    if q == 22 then set(":IN1","P2 Button 1",1) end
    if q == 28 then set(":IN1","P2 Button 1",0) end
  end
  -- trace in short windows so the whole session stays affordable
  local m = frame % 40
  if m == 0 and frame > 120 then tap_on(); windows = windows + 1
  elseif m == 3 then tap_off() end
  if frame == 14000 then
    tap_off()
    local n = 0
    for pc, _ in pairs(hit) do
      if pc < 0x20000 then log:write(string.format("%05X", pc)..NL); n = n + 1 end
    end
    log:write("# addresses "..n.." windows "..windows..NL)
    log:flush(); manager.machine:exit()
  end
end)
