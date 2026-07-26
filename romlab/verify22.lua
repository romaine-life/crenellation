-- Verify the phase dispatcher at 0xEE44.
-- Each queue record is a periodic timer: word0 counts down per pass, and on
-- reaching zero the handler at +4 is called with the parameter at +8 and the
-- countdown reloads from the period byte at +2. Byte +3 decides whether the
-- record still runs while the gate at 0x3E0802 is set.
--
-- Handlers point at a bare rts in ROM, so nothing else happens; whether a
-- record fired is visible in its countdown - a fired record reloads, an
-- unfired one keeps the decremented value.
local OUT = "D:/repos/crenellation/romlab/out/verify22/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK = 0xEE44, 0x0FFFF0, 0x3E2000
local COUNT, TABLE, GATE = 0x3E1CF4, 0x3E1CF6, 0x3E0802
local NOP = 0xEE42     -- a bare rts
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}

-- {countdown, period, flag}
local CASES = {
  { n="empty",     count=0xFFFF, gate=0, recs={} },
  { n="notdue",    count=0,      gate=0, recs={{5,9,1}} },
  { n="fires",     count=0,      gate=0, recs={{1,9,1}} },
  { n="atzero",    count=0,      gate=0, recs={{0,7,1}} },
  { n="gated_off", count=0,      gate=1, recs={{1,9,0}} },
  { n="gated_on",  count=0,      gate=1, recs={{1,9,1}} },
  { n="gate0flag0",count=0,      gate=0, recs={{1,9,0}} },
  { n="three",     count=2,      gate=0, recs={{1,4,1},{3,6,1},{1,8,1}} },
  { n="mixedgate", count=2,      gate=1, recs={{1,4,0},{1,6,1},{5,8,0}} },
  { n="negcount",  count=0,      gate=0, recs={{0xFFFE,3,1}} },
}
local frame, ci, saved, returned, waited = 0, 1, nil, false, 0
local phase = "idle"
local function save_state()
  local s={} for _,r in ipairs(REGS) do local ok,v=pcall(function() return cpu.state[r].value end); if ok then s[r]=v end end
  s.gate = space:read_u16(GATE); s.cnt = space:read_u16(COUNT)
  return s
end
local function restore_state(s)
  for _,r in ipairs(REGS) do if s[r] then pcall(function() cpu.state[r].value=s[r] end) end end
  pcall(function() space:write_u16(GATE, s.gate); space:write_u16(COUNT, s.cnt) end)
end
local function install()
  TAPS[#TAPS+1]=space:install_read_tap(SENTINEL,SENTINEL+1,"d",function(o,d,m) returned=true; return d end)
end
local function start_case(c)
  saved = save_state()
  for i = 0, 12*8-1 do space:write_u8(TABLE + i, 0) end
  space:write_u16(COUNT, c.count)
  space:write_u16(GATE, c.gate)
  for i, r in ipairs(c.recs) do
    local b = TABLE + (i-1)*12
    space:write_u16(b, r[1])
    space:write_u8(b+2, r[2])
    space:write_u8(b+3, r[3])
    space:write_u32(b+4, NOP)
    space:write_u32(b+8, 0x1234 + i)
  end
  local sp = STACK - 4
  space:write_u32(sp, SENTINEL)
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
    local t = {}
    for i = 0, 3 do t[#t+1] = string.format("%04X", space:read_u16(TABLE + i*12)) end
    log:write(string.format("D %s %04X %s", c.n, space:read_u16(COUNT), table.concat(t, " "))..NL)
  elseif waited < 3 then return
  else log:write(string.format("D %s NORETURN", c.n)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
