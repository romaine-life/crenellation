-- Find the routine that moves a shot.
-- player+0x6A points at a ring of 0x1A-byte shot records. Reading that pointer
-- live and tapping writes across the ring names whatever integrates velocity
-- into position - CURPC gives the exact instruction.
local OUT = "D:/repos/crenellation/romlab/out/shots2/"
local log = io.open(OUT .. "s.log", "w")
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
  if not armed and frame > 1500 then
    for i = 0, 2 do
      local pl = 0x3E1968 + i*0x7E
      local ring = space:read_u32(pl + 0x6A)
      if ring >= 0x3E0000 and ring <= 0x3EFF00 then
        log:write(string.format("player %d ring %06X", i, ring)..NL)
        TAPS[#TAPS+1] = space:install_write_tap(ring, ring + 0x1A*8 - 1, "r"..i,
          function(o,d,m)
            local pc = cpu.state["CURPC"].value
            local off = (o - ring) % 0x1A
            local k = string.format("%06X off%02X", pc, off)
            hits[k] = (hits[k] or 0) + 1
            return d
          end)
        armed = true
      end
    end
    if armed then log:flush() end
  end
  if frame == 9000 then
    local n = 0
    for k,v in pairs(hits) do log:write(string.format("W %s %d", k, v)..NL); n=n+1 end
    log:write("entries "..n..NL); log:flush(); manager.machine:exit()
  end
end)
