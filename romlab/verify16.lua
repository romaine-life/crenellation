-- Verify the damage step handler at 0x8606.
-- It reads one packed coordinate from the list at player+0x3E, and where the
-- board cell is empty it stamps rubble (0x30). It then advances the cursor by
-- a word, and when the next entry's high byte is negative it removes its own
-- event. Crafted lists exercise empty cells, occupied cells and termination.
local OUT = "D:/repos/crenellation/romlab/out/verify16/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK = 0x8606, 0x0FFFF0, 0x3E2000
local BOARD, PLAYER, LIST = 0x3E0864, 0x3E2400, 0x3E2500
local COUNT, TABLE = 0x3E1CF4, 0x3E1CF6
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}
local function cell(x,y) return BOARD + x*32 + y end

local CASES = {
  { n="empty",    list={{10,10},{11,10},{-1,0}}, pre={}, idx=0 },
  { n="occupied", list={{10,10},{11,10},{-1,0}}, pre={{10,10,0x41}}, idx=0 },
  { n="second",   list={{10,10},{11,10},{-1,0}}, pre={}, idx=1 },
  { n="onwall",   list={{12,12},{-1,0}},         pre={{12,12,0x45}}, idx=0 },
  { n="onrubble", list={{13,13},{-1,0}},         pre={{13,13,0x30}}, idx=0 },
  { n="terminate",list={{14,14},{-1,0}},         pre={}, idx=0 },
  { n="edge",     list={{0,0},{41,29},{-1,0}},   pre={}, idx=0 },
  { n="corner",   list={{41,29},{-1,0}},         pre={}, idx=0 },
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
  for i = 0, 42*32-1 do space:write_u8(BOARD + i, 0) end
  for _, e in ipairs(c.pre) do space:write_u8(cell(e[1],e[2]), e[3]) end
  for i, e in ipairs(c.list) do
    local x = e[1] % 256
    space:write_u16(LIST + (i-1)*2, x*256 + (e[2] % 256))
  end
  for i = 0, 0x90 do space:write_u8(PLAYER + i, 0) end
  space:write_u32(PLAYER + 0x3E, LIST + c.idx*2)
  space:write_u16(COUNT, 0)
  space:write_u32(TABLE + 4, 0x00008606)
  space:write_u32(TABLE + 8, PLAYER)
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
    local t = {}
    for i = 0, 42*32-1 do t[#t+1] = string.char(space:read_u8(BOARD + i)) end
    local fh = io.open(OUT..c.n..".bin","wb"); fh:write(table.concat(t)); fh:close()
    log:write(string.format("R %s %08X %04X", c.n,
      space:read_u32(PLAYER + 0x3E) - LIST, space:read_u16(COUNT))..NL)
  elseif waited < 3 then return
  else log:write(string.format("R %s NORETURN", c.n)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
