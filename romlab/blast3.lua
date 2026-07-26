-- Call 0x8598 against the LIVE level state.
-- The routine is phase-gated and never ran on its own during capture, so
-- invoke it directly at a moment when a level is loaded: flag the real players,
-- run the routine to a sentinel, and read the cursors it parks. The descriptor
-- at 0x3E0DCA is the real one, so the scripts are the real ones.
local OUT = "D:/repos/crenellation/romlab/out/blast3/"
local log = io.open(OUT .. "b.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local SENTINEL, STACK = 0x0FFFF0, 0x3E2000
local PLAYERS = 0x3E1968
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}
local frame, tx, ty = 0, 0, 0
local saved, returned, waited, skip = nil, false, 0, 0
local phase = "play"

local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end
local function save_state()
  local s={} for _,r in ipairs(REGS) do local ok,v=pcall(function() return cpu.state[r].value end); if ok then s[r]=v end end
  s.pl={} for k=0,3*0x7E-1 do s.pl[k]=space:read_u8(PLAYERS+k) end
  s.cnt=space:read_u16(0x3E1CF4)
  return s
end
local function restore_state(s)
  for _,r in ipairs(REGS) do if s[r] then pcall(function() cpu.state[r].value=s[r] end) end end
  for k=0,3*0x7E-1 do space:write_u8(PLAYERS+k, s.pl[k]) end
  space:write_u16(0x3E1CF4, s.cnt)
end
TAPS[#TAPS+1] = nil

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 500 then
    TAPS[#TAPS+1] = space:install_read_tap(SENTINEL, SENTINEL+1, "d",
      function(o,d,m) returned = true; return d end)
  end
  if frame > 600 and frame < 12000 then
    local c = frame % 240
    if c == 0 then set(":IN1","Coin 1",1) end
    if c == 20 then set(":IN1","Coin 1",0) end
    if c == 40 then set(":IN1","P1 Button 1",1) end
    if c == 50 then set(":IN1","P1 Button 1",0) end
  end
  if frame > 900 and phase == "play" then
    tx=(tx+7)%256; ty=(ty+11)%256
    set(":TRACK3","Trackball X",tx); set(":TRACK2","Trackball Y",ty)
    local q = frame % 45
    if q == 0 then set(":IN1","P1 Button 1",1) end
    if q == 6 then set(":IN1","P1 Button 1",0) end
  end

  if phase == "play" and frame > 3000 and (frame % 400) == 0 and skip < 6 then
    saved = save_state()
    for i = 0, 2 do
      local pl = PLAYERS + i*0x7E
      space:write_u16(pl, space:read_u16(pl) | 0x8000)
      space:write_u8(pl + 0x1D, skip)
    end
    local sp = STACK - 4
    space:write_u32(sp, SENTINEL)
    cpu.state["SP"].value = sp
    cpu.state["PC"].value = 0x8598
    returned = false; waited = 0
    phase = "call"
    return
  end

  if phase == "call" then
    waited = waited + 1
    if returned then
      local desc = space:read_u32(0x3E0DCA)
      for i = 0, 2 do
        local pl = PLAYERS + i*0x7E
        local cur = space:read_u32(pl + 0x3E)
        if cur >= 0x400 and cur < 0x100000 then
          local parts = {}
          for k = 0, 63 do parts[#parts+1] = string.format("%02X", space:read_u8(cur+k)) end
          log:write(string.format("C p%d skip %d desc %06X sel %02X cur %06X %s",
            i, skip, desc, space:read_u8(pl+3), cur, table.concat(parts))..NL)
        end
      end
      log:flush()
    elseif waited < 3 then return
    else log:write("NORETURN skip "..skip..NL); log:flush() end
    restore_state(saved); saved = nil; skip = skip + 1; phase = "play"
  end

  if frame == 9000 then log:write("done"..NL); log:flush(); manager.machine:exit() end
end)
