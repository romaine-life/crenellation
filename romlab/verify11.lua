-- Verify the event-table membership test at 0xEFFA.
-- Records are 12 bytes at 0x3E1CF6, the count is the word at 0x3E1CF4, and the
-- key compared is the long at record+4. The loop is a dbra, so it inspects
-- count+1 records - an off-by-one worth pinning down rather than assuming.
local OUT = "D:/repos/crenellation/romlab/out/verify11/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK = 0x0EFFA, 0x0FFFF0, 0x3E2000
local COUNT, TABLE, KEY = 0x3E1CF4, 0x3E1CF6, 0x3E2200
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}

local CASES = {
  { n="empty_neg",  count=0xFFFF, recs={0x11111111}, key=0x11111111 },
  { n="one_hit",    count=0,      recs={0x11111111}, key=0x11111111 },
  { n="one_miss",   count=0,      recs={0x11111111}, key=0x22222222 },
  { n="four_first", count=3,      recs={0xAAAA0001,0xAAAA0002,0xAAAA0003,0xAAAA0004}, key=0xAAAA0001 },
  { n="four_mid",   count=3,      recs={0xAAAA0001,0xAAAA0002,0xAAAA0003,0xAAAA0004}, key=0xAAAA0003 },
  { n="four_last",  count=3,      recs={0xAAAA0001,0xAAAA0002,0xAAAA0003,0xAAAA0004}, key=0xAAAA0004 },
  { n="four_miss",  count=3,      recs={0xAAAA0001,0xAAAA0002,0xAAAA0003,0xAAAA0004}, key=0xAAAA0009 },
  { n="past_count", count=1,      recs={0xAAAA0001,0xAAAA0002,0xAAAA0003,0xAAAA0004}, key=0xAAAA0004 },
  { n="at_count",   count=1,      recs={0xAAAA0001,0xAAAA0002,0xAAAA0003,0xAAAA0004}, key=0xAAAA0002 },
  { n="zero_key",   count=2,      recs={0x00000000,0xAAAA0002,0xAAAA0003}, key=0x00000000 },
  { n="dup",        count=2,      recs={0xAAAA0007,0xAAAA0007,0xAAAA0007}, key=0xAAAA0007 },
  { n="big_count",  count=8,      recs={1,2,3,4,5,6,7,8,9}, key=9 },
}

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
  for i = 0, 0x200 do space:write_u8(TABLE + i, 0) end
  space:write_u16(COUNT, c.count)
  for i, v in ipairs(c.recs) do
    space:write_u32(TABLE + (i-1)*12, 0)
    space:write_u32(TABLE + (i-1)*12 + 4, v)
  end
  space:write_u32(KEY, c.key)
  local sp = STACK
  sp = sp - 4; space:write_u32(sp, KEY)       -- pointer to the key
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
    log:write(string.format("R %s %08X", c.n, cpu.state["D0"].value % 0x100000000)..NL)
  elseif waited < 3 then return
  else log:write(string.format("R %s NORETURN", c.n)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
