-- Verify piece selection at 0x5948: kind derivation, the shared bag cursor,
-- and the anti-repeat rule.
--
-- The routine takes a player pointer, picks a bag kind from that player's own
-- state, draws the next byte from the cursor for that KIND (not that player),
-- and redraws when the group repeats the player's previous one - except for the
-- single-cell piece.
local OUT = "D:/repos/crenellation/romlab/out/verify26/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK = 0x5948, 0x0FFFF0, 0x3E2000
local PA, PB = 0x3E2400, 0x3E2480      -- two scratch player structs
local BAG = 0x3E2600                   -- a controlled bag
local CUR = 0x3E1F0A                   -- bag cursors, indexed by kind
local LEVEL = 0x3E195C
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}

-- bag bytes are group indices; 0 is the single cell, 1 the 3-bar, 2 the L
local BAGBYTES = { 1, 1, 2, 0, 0, 3, 0xFF }

local CASES = {
  { n="kind0",      w0=0x0000, f14=0, f1f=0, prev=0, who="A" },
  { n="kind1_f14",  w0=0x0000, f14=1, f1f=0, prev=0, who="A" },
  { n="kind1_f1f",  w0=0x0000, f14=0, f1f=4, prev=0, who="A" },
  { n="kind2_flag", w0=0x4000, f14=0, f1f=0, prev=0, who="A" },
  { n="norepeat",   w0=0x0000, f14=0, f1f=0, prev="first", who="A" },
  { n="single_ok",  w0=0x0000, f14=0, f1f=0, prev="single", who="A" },
  { n="sharedA",    w0=0x0000, f14=0, f1f=0, prev=0, who="A", keep=true },
  { n="sharedB",    w0=0x0000, f14=0, f1f=0, prev=0, who="B", keep=true },
}

local frame, ci, saved, returned, waited = 0, 1, nil, false, 0
local phase = "idle"
local function save_state()
  local s={} for _,r in ipairs(REGS) do local ok,v=pcall(function() return cpu.state[r].value end); if ok then s[r]=v end end
  s.cur={} for k=0,2 do s.cur[k]=space:read_u32(CUR+k*4) end
  s.lvl=space:read_u8(LEVEL)
  return s
end
local function restore_state(s)
  for _,r in ipairs(REGS) do if s[r] then pcall(function() cpu.state[r].value=s[r] end) end end
  for k=0,2 do space:write_u32(CUR+k*4, s.cur[k]) end
  space:write_u8(LEVEL, s.lvl)
end
local function install()
  TAPS[#TAPS+1]=space:install_read_tap(SENTINEL,SENTINEL+1,"d",function(o,d,m) returned=true; return d end)
end
local function start_case(c)
  saved = save_state()
  local pl = (c.who == "A") and PA or PB
  for i = 0, 0x7E do space:write_u8(PA + i, 0); space:write_u8(PB + i, 0) end
  space:write_u16(pl, c.w0)
  space:write_u8(pl + 0x14, c.f14)
  space:write_u8(pl + 0x1F, c.f1f)
  space:write_u8(LEVEL, 0)
  if not c.keep then
    for i, v in ipairs(BAGBYTES) do space:write_u8(BAG + (i-1), v) end
    for k = 0, 2 do space:write_u32(CUR + k*4, BAG) end
  end
  -- prev group: "first" = the group the bag's first byte selects, "single" = group 0
  if c.prev == "first" then
    space:write_u32(pl + 0x28, space:read_u32(0xFF90 + BAGBYTES[1]*4))
  elseif c.prev == "single" then
    space:write_u32(pl + 0x28, space:read_u32(0xFF90))
    space:write_u8(BAG, 0)
  end
  -- argument at +0x20 from the callee's frame: return address then the pointer
  local sp = STACK - 8
  space:write_u32(sp + 4, pl)
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
    local pl = (c.who == "A") and PA or PB
    log:write(string.format("R %s grp %08X prev %08X cur0 %d cur1 %d cur2 %d", c.n,
      space:read_u32(pl + 0x24), space:read_u32(pl + 0x28),
      space:read_u32(CUR) - BAG, space:read_u32(CUR+4) - BAG, space:read_u32(CUR+8) - BAG)..NL)
  elseif waited < 3 then return
  else log:write(string.format("R %s NORETURN", c.n)..NL) end
  log:flush()
  local keepnext = CASES[ci+1] and CASES[ci+1].keep
  restore_state(saved); saved=nil; ci=ci+1
end)
