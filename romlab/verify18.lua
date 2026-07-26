-- Verify the piece-bag builder at 0x59EE.
-- It picks a weight list by player kind and level, emits that many copies of
-- each group index, terminates with 0xFF, then riffle shuffles using the RNG.
-- Fixing the RNG seed makes the whole thing reproducible, so bag construction,
-- the shuffle and the RNG integration are all checked at once.
local OUT = "D:/repos/crenellation/romlab/out/verify18/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK = 0x59EE, 0x0FFFF0, 0x3E2000
local SEED = 0x3E0842
local DEST = { [0]=0x3E1E76, [1]=0x3E1EA0, [2]=0x3E1ECA }
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}
local CASES = {}
for _, seed in ipairs({0x1234, 0x5EED, 0xFFFF}) do
  for kind = 0, 2 do
    for level = 0, 4 do
      CASES[#CASES+1] = { seed = seed, kind = kind, level = level }
    end
  end
end
local frame, ci, saved, returned, waited = 0, 1, nil, false, 0
local phase = "idle"
local function save_state()
  local s={} for _,r in ipairs(REGS) do local ok,v=pcall(function() return cpu.state[r].value end); if ok then s[r]=v end end
  s.seed = space:read_u16(SEED)
  return s
end
local function restore_state(s)
  for _,r in ipairs(REGS) do if s[r] then pcall(function() cpu.state[r].value=s[r] end) end end
  pcall(function() space:write_u16(SEED, s.seed) end)
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
    for k = 0, 2 do
      for i = 0, 63 do space:write_u8(DEST[k] + i, 0xAA) end
    end
    space:write_u16(SEED, c.seed)
    local sp = STACK
    sp = sp - 4; space:write_u32(sp, c.level)
    sp = sp - 4; space:write_u32(sp, c.kind)
    sp = sp - 4; space:write_u32(sp, SENTINEL)
    cpu.state["SP"].value = sp
    cpu.state["PC"].value = ENTRY
    returned = false; waited = 0
    return
  end
  waited = waited + 1
  if returned then
    local d = DEST[c.kind] or DEST[2]
    local t = {}
    for i = 0, 47 do t[#t+1] = string.format("%02X", space:read_u8(d + i)) end
    log:write(string.format("B %04X %d %d %04X %s", c.seed, c.kind, c.level,
                            space:read_u16(SEED), table.concat(t))..NL)
  elseif waited < 3 then return
  else log:write(string.format("B %04X %d %d NORETURN", c.seed, c.kind, c.level)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
