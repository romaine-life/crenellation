-- Verify the event queue: 0xEE90 (post) and 0xEEEE (remove).
-- Records are 12 bytes at 0x3E1CF6 with the count in the word at 0x3E1CF4.
-- Both take (handler pointer, param); the handler's own bytes +4 and +5 are
-- copied into the record, and posting deduplicates on key AND param.
local OUT = "D:/repos/crenellation/romlab/out/verify13/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local SENTINEL, STACK = 0x0FFFF0, 0x3E2000
local COUNT, TABLE = 0x3E1CF4, 0x3E1CF6
local H = 0x3E2300      -- scratch handler structs
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}

-- handler i: key = 0xC0DE0000+i, bytes +4/+5 = 0x10+i / 0x20+i
local function hptr(i) return H + i*8 end

local CASES = {
  { n="post_empty",  op="post", count=0xFFFF, pre={},                 h=1, p=0x1111 },
  { n="post_append", op="post", count=0,      pre={{1,0x1111}},       h=2, p=0x2222 },
  { n="post_dup",    op="post", count=0,      pre={{1,0x1111}},       h=1, p=0x1111 },
  { n="post_samekey",op="post", count=0,      pre={{1,0x1111}},       h=1, p=0x9999 },
  { n="post_third",  op="post", count=1,      pre={{1,0x1111},{2,0x2222}}, h=3, p=0x3333 },
  { n="rm_first",    op="rm",   count=2,      pre={{1,0x1111},{2,0x2222},{3,0x3333}}, h=1, p=0x1111 },
  { n="rm_mid",      op="rm",   count=2,      pre={{1,0x1111},{2,0x2222},{3,0x3333}}, h=2, p=0x2222 },
  { n="rm_last",     op="rm",   count=2,      pre={{1,0x1111},{2,0x2222},{3,0x3333}}, h=3, p=0x3333 },
  { n="rm_missing",  op="rm",   count=2,      pre={{1,0x1111},{2,0x2222},{3,0x3333}}, h=4, p=0x4444 },
  { n="rm_wrongparam",op="rm",  count=2,      pre={{1,0x1111},{2,0x2222},{3,0x3333}}, h=2, p=0x7777 },
  { n="rm_empty",    op="rm",   count=0xFFFF, pre={},                 h=1, p=0x1111 },
  { n="rm_single",   op="rm",   count=0,      pre={{1,0x1111}},       h=1, p=0x1111 },
}

local frame, ci, saved, returned = 0, 1, nil, false
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
  for i = 0, 8 do
    space:write_u32(hptr(i), 0xC0DE0000 + i)
    space:write_u8(hptr(i) + 4, 0x10 + i)
    space:write_u8(hptr(i) + 5, 0x20 + i)
  end
  for i = 0, 12*10 do space:write_u8(TABLE + i, 0) end
  space:write_u16(COUNT, c.count)
  for i, e in ipairs(c.pre) do
    local base = TABLE + (i-1)*12
    space:write_u16(base, 0x10 + e[1])
    space:write_u8(base + 2, 0x10 + e[1])
    space:write_u8(base + 3, 0x20 + e[1])
    space:write_u32(base + 4, 0xC0DE0000 + e[1])
    space:write_u32(base + 8, e[2])
  end
  local sp = STACK
  sp = sp - 4; space:write_u32(sp, c.p)
  sp = sp - 4; space:write_u32(sp, hptr(c.h))
  sp = sp - 4; space:write_u32(sp, SENTINEL)
  cpu.state["SP"].value = sp
  cpu.state["PC"].value = (c.op == "post") and 0xEE90 or 0xEEEE
  returned = false
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install(); phase="run"; return end
  if phase ~= "run" then return end
  if ci > #CASES then log:write("done"..NL); log:flush(); manager.machine:exit(); return end
  local c = CASES[ci]
  if not saved then start_case(c); return end
  if returned then
    local t = {}
    for i = 0, 12*8-1 do t[#t+1] = string.format("%02X", space:read_u8(TABLE + i)) end
    log:write(string.format("R %s %04X %s", c.n, space:read_u16(COUNT), table.concat(t))..NL)
  else log:write(string.format("R %s NORETURN", c.n)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
