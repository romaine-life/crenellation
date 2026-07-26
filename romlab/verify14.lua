-- Verify the territory scoring routine at 0x865E.
-- It takes the claimed-cell count from player+0x58, finds the first threshold
-- in the table at 0x117CE that is >= that count, and adds the matching award
-- from 0x117E2 to player+0x56 - the score.
local OUT = "D:/repos/crenellation/romlab/out/verify14/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK = 0x865E, 0x0FFFF0, 0x3E2000
local PLAYER = 0x3E2400
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}
local COUNTS = {0,1,8,9,10,15,16,17,24,25,26,35,36,49,63,64,80,81,99,100,120,121,122,500,998,999,1000,5000}
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
emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install(); phase="run"; return end
  if phase ~= "run" then return end
  if ci > #COUNTS then log:write("done"..NL); log:flush(); manager.machine:exit(); return end
  local n = COUNTS[ci]
  if not saved then
    saved = save_state()
    for i = 0, 0x90 do space:write_u8(PLAYER + i, 0) end
    space:write_u8(PLAYER + 2, 0)          -- player index
    space:write_u16(PLAYER + 0x58, n)      -- cells claimed
    space:write_u16(PLAYER + 0x56, 1000)   -- a nonzero starting score
    local sp = STACK
    sp = sp - 4; space:write_u32(sp, PLAYER)
    sp = sp - 4; space:write_u32(sp, SENTINEL)
    cpu.state["SP"].value = sp
    cpu.state["PC"].value = ENTRY
    returned = false; waited = 0
    return
  end
  waited = waited + 1
  if returned then
    log:write(string.format("R %d %d %02X", n, space:read_u16(PLAYER + 0x56),
                            space:read_u8(PLAYER + 0x3C))..NL)
  elseif waited < 3 then return
  else log:write(string.format("R %d NORETURN", n)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
