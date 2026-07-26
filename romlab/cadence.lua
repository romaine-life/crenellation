-- Measure how often the projectile and unit integrations actually run.
-- Tap the exact integrating instructions and count executions per frame; the
-- distribution says whether the update is once per frame, per shot, or driven
-- by something else.
local OUT = "D:/repos/crenellation/romlab/out/cadence/"
local log = io.open(OUT .. "c.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local frame, tx, ty = 0, 0, 0
local shot, unit = 0, 0
local hist_shot, hist_unit = {}, {}
local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end
emu.register_frame_done(function()
  frame = frame + 1
  if frame == 700 then
    -- 0x7062 integrates a shot's x; 0xAF90 integrates a unit's x
    -- count the WRITES those instructions make; a read tap on the opcode
    -- catches 68000 prefetch rather than execution
    for _, base in ipairs({0x3E0F48, 0x3E1254, 0x3E1560}) do
      TAPS[#TAPS+1] = space:install_write_tap(base, base + 0x1A*8 - 1, "s",
        function(o,d,m)
          if cpu.state["CURPC"].value == 0x7062 then shot = shot + 1 end
          return d
        end)
    end
    TAPS[#TAPS+1] = space:install_write_tap(0x3E1BC6, 0x3E1BC6 + 0x12*7 - 1, "u",
      function(o,d,m)
        if cpu.state["CURPC"].value == 0xAF90 then unit = unit + 1 end
        return d
      end)
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
  if frame > 700 then
    -- count active shots and units this frame, to compare against the calls
    local ns = 0
    for r = 1, 3 do
      local base = ({0x3E0F48, 0x3E1254, 0x3E1560})[r]
      for s = 0, 7 do
        if space:read_u32(base + s*0x1A + 0x16) ~= 0 then ns = ns + 1 end
      end
    end
    local nu = 0
    for s = 0, 6 do
      if space:read_u32(0x3E1BC6 + s*0x12 + 4) ~= 0 then nu = nu + 1 end
    end
    if shot > 0 or ns > 0 then
      local k = string.format("%d/%d", shot, ns)
      hist_shot[k] = (hist_shot[k] or 0) + 1
    end
    if unit > 0 or nu > 0 then
      local k = string.format("%d/%d", unit, nu)
      hist_unit[k] = (hist_unit[k] or 0) + 1
    end
    shot, unit = 0, 0
  end
  if frame == 9000 then
    log:write("SHOT calls/active -> frames"..NL)
    for k,v in pairs(hist_shot) do log:write("  "..k.." "..v..NL) end
    log:write("UNIT calls/active -> frames"..NL)
    for k,v in pairs(hist_unit) do log:write("  "..k.." "..v..NL) end
    log:flush(); manager.machine:exit()
  end
end)
