-- Verify the enclosure test at 0xBC2 against crafted boards.
--
-- The routine traces a wall boundary, turning as it goes, and counts total
-- turning; a closed loop nets four quarter-turns and the sign says which way
-- round it went. Feeding it boards built by hand - closed rectangles of several
-- sizes, open walls, concave shapes - exercises exactly the cases the game's
-- own play would only reach by accident.
local OUT = "D:/repos/crenellation/romlab/out/verify9/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY = 0x0BC2
local SENTINEL = 0x0FFFF0
local STACK = 0x3E2000
local BOARD = 0x3E0864
local PLAYER = 0x3E2100          -- scratch struct; byte +2 is the player index
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}

local WALL = 0x41                -- owner 0x40 | 1

local function cell(x, y) return BOARD + x * 32 + y end

local function clear_board()
  for i = 0, 42 * 32 - 1 do space:write_u8(BOARD + i, 0) end
end
local function rect(x0, y0, w, h, v)
  for x = x0, x0 + w - 1 do
    space:write_u8(cell(x, y0), v); space:write_u8(cell(x, y0 + h - 1), v)
  end
  for y = y0, y0 + h - 1 do
    space:write_u8(cell(x0, y), v); space:write_u8(cell(x0 + w - 1, y), v)
  end
end
local function hline(x0, y0, n, v)
  for x = x0, x0 + n - 1 do space:write_u8(cell(x, y0), v) end
end

local CASES = {
  { n="rect4x4",   build=function() rect(5,5,4,4,WALL) end,   x=5,  y=5,  dir=1 },
  { n="rect6x3",   build=function() rect(10,4,6,3,WALL) end,  x=10, y=4,  dir=1 },
  { n="rect3x6",   build=function() rect(2,2,3,6,WALL) end,   x=2,  y=2,  dir=1 },
  { n="rect12x9",  build=function() rect(8,10,12,9,WALL) end, x=8,  y=10, dir=1 },
  { n="rect2x2",   build=function() rect(20,20,2,2,WALL) end, x=20, y=20, dir=1 },
  { n="rect5x5",   build=function() rect(30,20,5,5,WALL) end, x=30, y=20, dir=1 },
  { n="edge",      build=function() rect(0,0,5,5,WALL) end,   x=0,  y=0,  dir=1 },
  { n="farcorner", build=function() rect(36,24,5,5,WALL) end, x=36, y=24, dir=1 },
  { n="mid",       build=function() rect(5,5,4,4,WALL) end,   x=6,  y=5,  dir=1 },
  { n="side",      build=function() rect(5,5,4,4,WALL) end,   x=8,  y=6,  dir=1 },
  { n="botleft",   build=function() rect(5,5,4,4,WALL) end,   x=5,  y=8,  dir=1 },
  { n="openline",  build=function() hline(3,3,8,WALL) end,    x=3,  y=3,  dir=1 },
  { n="single",    build=function() space:write_u8(cell(15,15),WALL) end, x=15, y=15, dir=1 },
  { n="gap",       build=function() rect(5,5,6,6,WALL) space:write_u8(cell(7,5),0) end, x=5, y=5, dir=1 },
  { n="concave",   build=function()
        rect(6,6,10,8,WALL)
        for y=6,9 do space:write_u8(cell(10,y),WALL) end
        for x=10,15 do space:write_u8(cell(x,9),WALL) end
        for x=11,14 do space:write_u8(cell(x,6),0) end
        for y=7,8 do space:write_u8(cell(15,y),0) end
      end, x=6, y=6, dir=1 },
  { n="twoowner",  build=function() rect(5,5,4,4,WALL) rect(20,5,4,4,0x81) end, x=5, y=5, dir=1 },
  { n="variant",   build=function() rect(5,5,4,4,WALL) space:write_u8(cell(6,5),0x43) end, x=5, y=5, dir=1 },
  { n="thin",      build=function() rect(4,4,2,8,WALL) end,   x=4,  y=4,  dir=1 },
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
  clear_board()
  space:write_u32(0x3E1960, PLAYER)
  space:write_u8(PLAYER + 2, 0)
  c.build()
  -- dump the board we built, so the port starts from exactly the same state
  local t = {}
  for i = 0, 42*32-1 do t[#t+1] = string.char(space:read_u8(BOARD + i)) end
  local fh = io.open(OUT .. c.n .. "-in.bin", "wb"); fh:write(table.concat(t)); fh:close()
  local sp = STACK
  sp = sp - 4; space:write_u32(sp, c.dir)             -- arg2 (word read at +0xE)
  sp = sp - 4; space:write_u32(sp, cell(c.x, c.y))    -- arg1 at +8
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
    for i = 0, 42*32-1 do t[#t+1] = string.char(space:read_u8(BOARD + i)) end
    local fh = io.open(OUT .. c.n .. "-out.bin", "wb"); fh:write(table.concat(t)); fh:close()
    log:write(string.format("R %s %d %d %d %08X", c.n, c.x, c.y, c.dir,
                            cpu.state["D0"].value % 0x100000000)..NL)
  elseif waited < 3 then
    return    -- give a long trace another frame
  else
    log:write(string.format("R %s %d %d %d NORETURN", c.n, c.x, c.y, c.dir)..NL)
  end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
