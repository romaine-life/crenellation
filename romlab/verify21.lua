-- Verify the cannon aiming handler at 0x6C20.
-- For the cannon record at player+0x6E it computes the direction from the
-- cannon to the target at player+0x4E/0x50 using the verified 0x11CF8, then
-- rotates the facing byte at record+4 one step the short way round.
local OUT = "D:/repos/crenellation/romlab/out/verify21/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK = 0x6C20, 0x0FFFF0, 0x3E2000
local PLAYER, RING = 0x3E2400, 0x3E2500
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}

local CASES = {}
-- cannon at grid (10,10); sweep the target around it and every starting facing
for _, t in ipairs({{200,80},{80,80},{80,200},{200,200},{140,20},{20,140},{140,250},{250,140}}) do
  for f = 0, 7 do
    CASES[#CASES+1] = { cx=10, cy=10, tx=t[1], ty=t[2], face=f }
  end
end
local frame, ci, saved, returned, waited = 0, 1, nil, false, 0
local phase = "idle"
local function save_state()
  local s={} for _,r in ipairs(REGS) do local ok,v=pcall(function() return cpu.state[r].value end); if ok then s[r]=v end end
  return s
end
local function restore_state(s)
  for _,r in ipairs(REGS) do if s[r] then pcall(function() cpu.state[r].value=s[r] end) end end
end
local function install()
  TAPS[#TAPS+1]=space:install_read_tap(SENTINEL,SENTINEL+1,"d",function(o,d,m) returned=true; return d end)
end
local function start_case(c)
  saved = save_state()
  for i = 0, 0x90 do space:write_u8(PLAYER + i, 0) end
  for i = 0, 0x60 do space:write_u8(RING + i, 0) end
  space:write_u8(RING + 0, c.cx)
  space:write_u8(RING + 1, c.cy)
  space:write_u8(RING + 4, c.face)
  space:write_u32(PLAYER + 0x6E, RING)
  space:write_u16(PLAYER + 0x4E, c.tx)
  space:write_u16(PLAYER + 0x50, c.ty)
  local sp = STACK
  sp = sp - 4; space:write_u32(sp, PLAYER)
  sp = sp - 4; space:write_u32(sp, SENTINEL)
  cpu.state["SP"].value = sp
  cpu.state["PC"].value = ENTRY
  returned = false; waited = 0
end
emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install(); phase="run"; return end
  if phase ~= "run" then return end
  if ci > #CASES then log:write("done"..NL); log:flush(); manager.machine:exit(); return end
  local c = CASES[ci]
  if not saved then start_case(c); return end
  waited = waited + 1
  if returned then
    log:write(string.format("A %d %d %d %d %d %02X %08X", c.cx, c.cy, c.tx, c.ty, c.face,
      space:read_u8(RING + 4), space:read_u32(PLAYER + 0x6E) - RING)..NL)
  elseif waited < 3 then return
  else log:write(string.format("A %d %d %d %d %d NORETURN", c.cx,c.cy,c.tx,c.ty,c.face)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
