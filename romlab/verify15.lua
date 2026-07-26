-- Verify the 8-way direction routine at 0x11CF8, used by cannon aiming.
local OUT = "D:/repos/crenellation/romlab/out/verify15/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK = 0x11CF8, 0x0FFFF0, 0x3E2000
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}
local CASES = {}
for _, p in ipairs({{1,0},{0,1},{-1,0},{0,-1},{1,1},{-1,1},{1,-1},{-1,-1},{0,0},
                    {10,1},{1,10},{10,4},{4,10},{7,16},{16,7},{7,-16},{-16,7},
                    {100,43},{100,44},{43,100},{44,100},{-100,-43},{-43,-100},
                    {32767,1},{1,32767},{-32768,1},{1,-32768},{255,255},{-255,255},
                    {3,7},{7,3},{5,12},{12,5},{20,9},{9,20}}) do
  CASES[#CASES+1] = { a = p[1], b = p[2] }
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
emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install(); phase="run"; return end
  if phase ~= "run" then return end
  if ci > #CASES then log:write("done"..NL); log:flush(); manager.machine:exit(); return end
  local c = CASES[ci]
  if not saved then
    saved = save_state()
    local sp = STACK
    sp = sp - 4; space:write_u32(sp, u32(c.b))
    sp = sp - 4; space:write_u32(sp, u32(c.a))
    sp = sp - 4; space:write_u32(sp, SENTINEL)
    cpu.state["SP"].value = sp
    cpu.state["PC"].value = ENTRY
    returned = false
    return
  end
  if returned then
    log:write(string.format("D %d %d %08X", c.a, c.b, cpu.state["D0"].value % 0x100000000)..NL)
  else log:write(string.format("D %d %d NORETURN", c.a, c.b)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
