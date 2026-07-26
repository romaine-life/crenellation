-- Stamp every piece with the ROM's own walker and dump the board.
--
-- 0x8B4 takes a packed (x,y), a pointer to the piece script, and a flag that
-- decides whether it merely validates or actually writes. Running all 40 table
-- entries onto a cleared board and dumping the result gives a per-piece
-- ground truth for the port to reproduce cell for cell.
local OUT = "D:/repos/crenellation/romlab/out/verify10/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK = 0x08B4, 0x0FFFF0, 0x3E2000
local BOARD, PLAYER = 0x3E0864, 0x3E2100
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}

-- table entries, from the parse: id byte then dx,dy then directions then 0xFF
local OFFS = {}
do
  local p, expect = 0xFE4E, 1
  while p < 0xFF90 do
    while space and false do break end
    p = p
    break
  end
end

local CASES = {}
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

-- build the case list by walking the table in ROM the same way
local function build_cases()
  local p, expect = 0xFE4E, 1
  while p < 0xFF90 do
    while space:read_u8(p) == 0 and space:read_u8(p+1) == expect do p = p + 1 end
    local pid = space:read_u8(p)
    if pid ~= expect then break end
    local q = p + 3
    while space:read_u8(q) < 0x80 do q = q + 1 end
    CASES[#CASES+1] = { id = pid, script = p + 1, x = 20, y = 14 }
    p = q + 1; expect = expect + 1
  end
  log:write("cases "..#CASES..NL); log:flush()
end

local function start_case(c)
  saved = save_state()
  for i = 0, 42*32-1 do space:write_u8(BOARD + i, 0) end
  space:write_u32(0x3E1960, PLAYER)
  space:write_u8(PLAYER + 2, 0)
  local sp = STACK
  sp = sp - 4; space:write_u32(sp, 1)                 -- flag: stamp
  sp = sp - 4; space:write_u32(sp, c.script)          -- script pointer
  sp = sp - 2; space:write_u16(sp, c.x * 256 + c.y)   -- packed coordinate
  sp = sp - 4; space:write_u32(sp, SENTINEL)
  cpu.state["SP"].value = sp
  cpu.state["PC"].value = ENTRY
  returned = false; waited = 0
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install(); build_cases(); phase="run"; return end
  if phase ~= "run" then return end
  if ci > #CASES then log:write("done"..NL); log:flush(); manager.machine:exit(); return end
  local c = CASES[ci]
  if not saved then start_case(c); return end
  waited = waited + 1
  if returned then
    local t = {}
    for i = 0, 42*32-1 do t[#t+1] = string.char(space:read_u8(BOARD + i)) end
    local fh = io.open(OUT..string.format("p%02X.bin", c.id), "wb"); fh:write(table.concat(t)); fh:close()
    log:write(string.format("R %02X %04X %d %d %08X", c.id, c.script, c.x, c.y,
                            cpu.state["D0"].value % 0x100000000)..NL)
  elseif waited < 3 then return
  else log:write(string.format("R %02X %04X %d %d NORETURN", c.id, c.script, c.x, c.y)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
