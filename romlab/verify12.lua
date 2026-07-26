-- Verify 0x11BEC: board coordinate -> framebuffer address.
-- It sits directly after the cell-address routine and maps a cell to the pixel
-- it is drawn at, which is what makes the 42x30 board line up with the screen.
local OUT = "D:/repos/crenellation/romlab/out/verify12/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK = 0x11BEC, 0x0FFFF0, 0x3E2000
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}
local CASES = {}
for _, xy in ipairs({{0,0},{1,0},{0,1},{41,29},{41,0},{0,29},{20,15},{7,23},{33,4},
                     {15,15},{42,30},{255,255},{128,128},{63,31},{200,7}}) do
  CASES[#CASES+1] = { x=xy[1], y=xy[2] }
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
emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install(); phase="run"; return end
  if phase ~= "run" then return end
  if ci > #CASES then log:write("done"..NL); log:flush(); manager.machine:exit(); return end
  local c = CASES[ci]
  if not saved then
    saved = save_state()
    local sp = STACK - 4
    space:write_u16(sp, (c.x % 256) * 256 + (c.y % 256))
    space:write_u16(sp+2, 0)
    sp = sp - 4; space:write_u32(sp, SENTINEL)
    cpu.state["SP"].value = sp
    cpu.state["PC"].value = ENTRY
    returned = false
    return
  end
  if returned then
    log:write(string.format("A %d %d %08X", c.x, c.y, cpu.state["D0"].value % 0x100000000)..NL)
  else log:write(string.format("A %d %d NORETURN", c.x, c.y)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
