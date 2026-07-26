-- Verify the damage script selector at 0x8598.
-- For each of three players whose word0 has bit 0x8000 set, it reaches a script
-- list through 0x3E0DCA -> +0x22 + player[3]*4, skips forward past player[0x1D]
-- sub-lists (each ending on a negative byte), parks the cursor at player+0x3E
-- and queues handler 0x8606.
--
-- The descriptor, the pointer table and the scripts are all crafted here, so
-- the selection logic is exercised without depending on a level being loaded.
local OUT = "D:/repos/crenellation/romlab/out/verify25/"
local log = io.open(OUT .. "v" .. 8 .. ".log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK = 0x8598, 0x0FFFF0, 0x3E2000
local PLAYERS, DESCPTR = 0x3E1968, 0x3E0DCA
local DESC, SCRIPTS = 0x3E2B00, 0x3E2C00
local COUNT, TABLE = 0x3E1CF4, 0x3E1CF6
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}

-- three sub-lists: 2 entries, 3 entries, 1 entry, each ending on a negative byte
local SCRIPT = { 0x0A0A, 0x0B0B, 0xFFFF, 0x0C0C, 0x0D0D, 0x0E0E, 0xFFFF, 0x0F0F, 0xFFFF }

local CASES = {
  { n="p0_sel3_skip0", flags={0x8000,0,0}, sel={3,0,0}, skip={0,0,0} },
  { n="p0_sel3_skip1", flags={0x8000,0,0}, sel={3,0,0}, skip={1,0,0} },
  { n="p0_sel3_skip2", flags={0x8000,0,0}, sel={3,0,0}, skip={2,0,0} },
  { n="p1_only",       flags={0,0x8000,0}, sel={0,3,0}, skip={0,1,0} },
  { n="p2_only",       flags={0,0,0x8000}, sel={0,0,3}, skip={0,0,2} },
  { n="none",          flags={0,0,0},      sel={3,3,3}, skip={0,0,0} },
  { n="all_three",     flags={0x8000,0x8000,0x8000}, sel={3,3,3}, skip={0,1,2} },
  { n="null_ptr",      flags={0x8000,0,0}, sel={1,0,0}, skip={0,0,0} },
}
CASES = { CASES[8] }
local frame, ci, saved, returned, waited = 0, 1, nil, false, 0
local phase = "idle"
local function save_state()
  local s={} for _,r in ipairs(REGS) do local ok,v=pcall(function() return cpu.state[r].value end); if ok then s[r]=v end end
  s.desc = space:read_u32(DESCPTR); s.cnt = space:read_u16(COUNT)
  -- 0x8598 hardcodes the live player array, so preserve it byte for byte
  s.players = {}
  for k = 0, 3*0x7E - 1 do s.players[k] = space:read_u8(PLAYERS + k) end
  return s
end
local function restore_state(s)
  for _,r in ipairs(REGS) do if s[r] then pcall(function() cpu.state[r].value=s[r] end) end end
  pcall(function()
    space:write_u32(DESCPTR, s.desc); space:write_u16(COUNT, s.cnt)
    for k = 0, 3*0x7E - 1 do space:write_u8(PLAYERS + k, s.players[k]) end
  end)
end
local function install()
  TAPS[#TAPS+1]=space:install_read_tap(SENTINEL,SENTINEL+1,"d",function(o,d,m) returned=true; return d end)
end
local function start_case(c)
  saved = save_state()
  for i = 0, 0x40 do space:write_u8(DESC + i, 0) end
  for i, v in ipairs(SCRIPT) do space:write_u16(SCRIPTS + (i-1)*2, v) end
  space:write_u32(DESCPTR, DESC)
  space:write_u32(DESC + 0x22 + 3*4, SCRIPTS)   -- index 3 -> our script
  space:write_u32(DESC + 0x22 + 1*4, 0)         -- index 1 -> null
  for i = 0, 2 do
    local pl = PLAYERS + i*0x7E
    for k = 0, 0x7D do space:write_u8(pl + k, 0) end
    space:write_u16(pl, c.flags[i+1])
    space:write_u8(pl + 3, c.sel[i+1])
    space:write_u8(pl + 0x1D, c.skip[i+1])
  end
  space:write_u16(COUNT, 0xFFFF)
  for i = 0, 12*6-1 do space:write_u8(TABLE + i, 0) end
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
    for i = 0, 2 do
      local v = space:read_u32(PLAYERS + i*0x7E + 0x3E)
      t[#t+1] = (v >= SCRIPTS and v < SCRIPTS + 64) and string.format("%d", v - SCRIPTS) or "-"
    end
    log:write(string.format("S %s %04X %s", c.n, space:read_u16(COUNT), table.concat(t, " "))..NL)
  elseif waited < 3 then return
  else log:write(string.format("S %s NORETURN", c.n)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
