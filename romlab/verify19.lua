-- Verify the flood-fill span scanner at 0x65AA.
-- It walks a column of the board from one coordinate to another and pushes the
-- START of every run of cells that differ from the given value onto the
-- coordinate stack at 0x3E209C - the seeds the territory fill works from.
local OUT = "D:/repos/crenellation/romlab/out/verify19/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK = 0x65AA, 0x0FFFF0, 0x3E2000
local BOARD, QBASE, QPTR = 0x3E0864, 0x3E2700, 0x3E209C
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}
local function cell(x,y) return BOARD + x*32 + y end

local CASES = {
  { n="allsame",  col=10, y0=5, y1=15, val=0x41, fill={} },
  { n="alldiff",  col=10, y0=5, y1=15, val=0x41, fill={{5,15,0x00}} },
  { n="onerun",   col=10, y0=5, y1=15, val=0x41, fill={{8,10,0x00}} },
  { n="tworuns",  col=10, y0=5, y1=15, val=0x41, fill={{6,7,0x00},{11,13,0x00}} },
  { n="atstart",  col=10, y0=5, y1=15, val=0x41, fill={{5,6,0x00}} },
  { n="atend",    col=10, y0=5, y1=15, val=0x41, fill={{14,15,0x00}} },
  { n="alternate",col=10, y0=5, y1=15, val=0x41, fill={{5,5,0},{7,7,0},{9,9,0},{11,11,0},{13,13,0}} },
  { n="single",   col=10, y0=7, y1=7,  val=0x41, fill={{7,7,0x00}} },
  { n="singlesame",col=10,y0=7, y1=7,  val=0x41, fill={} },
  { n="othercol", col=25, y0=0, y1=29, val=0x00, fill={{10,20,0x41}} },
}
local frame, ci, saved, returned, waited = 0, 1, nil, false, 0
local phase = "idle"
local function save_state()
  local s={} for _,r in ipairs(REGS) do local ok,v=pcall(function() return cpu.state[r].value end); if ok then s[r]=v end end
  s.q = space:read_u32(QPTR)
  return s
end
local function restore_state(s)
  for _,r in ipairs(REGS) do if s[r] then pcall(function() cpu.state[r].value=s[r] end) end end
  pcall(function() space:write_u32(QPTR, s.q) end)
end
local function install()
  TAPS[#TAPS+1]=space:install_read_tap(SENTINEL,SENTINEL+1,"d",function(o,d,m) returned=true; return d end)
end
local function start_case(c)
  saved = save_state()
  for i = 0, 42*32-1 do space:write_u8(BOARD + i, c.val) end
  for _, f in ipairs(c.fill) do
    for y = f[1], f[2] do space:write_u8(cell(c.col, y), f[3]) end
  end
  for i = 0, 63 do space:write_u8(QBASE + i, 0) end
  space:write_u32(QPTR, QBASE)
  local sp = STACK
  sp = sp - 4; space:write_u32(sp, c.val)                 -- byte read at +0xF
  sp = sp - 2; space:write_u16(sp, c.col*256 + c.y1)      -- end coord at +0xA
  sp = sp - 2; space:write_u16(sp, c.col*256 + c.y0)      -- start coord at +8
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
    local t = {}
    for i = 0, 31 do t[#t+1] = string.format("%02X", space:read_u8(QBASE + i)) end
    log:write(string.format("Q %s %d %s", c.n, space:read_u32(QPTR) - QBASE, table.concat(t))..NL)
  elseif waited < 3 then return
  else log:write(string.format("Q %s NORETURN", c.n)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
