-- Verify piece rotation at 0x5AFC.
-- It takes a pointer to the slot holding the current piece pointer, advances
-- it by one entry, and on hitting the group's 0 terminator steps past it and
-- loads the wrap-back pointer that follows - returning 1 when it wrapped.
-- Starting from every slot in the table exercises both paths for all 13 groups.
local OUT = "D:/repos/crenellation/romlab/out/verify17/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK, SLOT = 0x5AFC, 0x0FFFF0, 0x3E2000, 0x3E2600
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}
local CASES = {}
for a = 0x11636, 0x1173A, 2 do CASES[#CASES+1] = a end
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
  local v = CASES[ci]
  if not saved then
    saved = save_state()
    space:write_u32(SLOT, v)
    local sp = STACK
    sp = sp - 4; space:write_u32(sp, SLOT)
    sp = sp - 4; space:write_u32(sp, SENTINEL)
    cpu.state["SP"].value = sp
    cpu.state["PC"].value = ENTRY
    returned = false
    return
  end
  if returned then
    log:write(string.format("P %06X %08X %08X", v, space:read_u32(SLOT),
                            cpu.state["D0"].value % 0x100000000)..NL)
  else log:write(string.format("P %06X NORETURN", v)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
