-- Verify two pure routines the board logic rests on:
--   0x11BD8  cell address from a packed (x,y) word
--   0x11D5C  octagonal distance approximation (blast/ranging math)
local OUT = "D:/repos/crenellation/romlab/out/verify8/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local SENTINEL = 0x0FFFF0
local STACK = 0x3E2000
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}

local CASES = {}
-- cell address: every corner and a spread of interior coordinates
for _, xy in ipairs({{0,0},{1,0},{0,1},{41,29},{41,0},{0,29},{20,15},{7,23},{33,4},{15,15},{42,30},{255,255}}) do
  CASES[#CASES+1] = { kind="cell", x=xy[1], y=xy[2] }
end
-- distance: axis, diagonal, negative, zero, large
for _, d in ipairs({{0,0},{1,0},{0,1},{3,4},{4,3},{-3,4},{3,-4},{-3,-4},{10,10},{100,1},
                    {1,100},{255,255},{-1,-1},{7,24},{24,7},{50,50},{32767,1},{-32768,5}}) do
  CASES[#CASES+1] = { kind="dist", a=d[1], b=d[2] }
end

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
local function u32(v) return v % 0x100000000 end
local function start_case(c)
  saved = save_state()
  local sp = STACK
  if c.kind == "cell" then
    sp = sp - 4
    space:write_u16(sp, (c.x % 256) * 256 + (c.y % 256))   -- word arg at +4
    space:write_u16(sp + 2, 0)
    sp = sp - 4; space:write_u32(sp, SENTINEL)
    cpu.state["PC"].value = 0x11BD8
  else
    sp = sp - 4; space:write_u32(sp, u32(c.b))              -- arg2 at +8
    sp = sp - 4; space:write_u32(sp, u32(c.a))              -- arg1 at +4
    sp = sp - 4; space:write_u32(sp, SENTINEL)
    cpu.state["PC"].value = 0x11D5C
  end
  cpu.state["SP"].value = sp
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
    if c.kind == "cell" then
      log:write(string.format("CELL %d %d %08X", c.x, c.y, cpu.state["D0"].value % 0x100000000)..NL)
    else
      log:write(string.format("DIST %d %d %08X", c.a, c.b, cpu.state["D0"].value % 0x100000000)..NL)
    end
  else
    log:write("NORETURN"..NL)
  end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
