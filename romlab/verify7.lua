-- Re-run the nine art decodes that mismatched during live capture, in the
-- controlled harness where no other routine can touch the destination.
-- If they match here, the live mismatches were readback contamination.
local OUT = "D:/repos/crenellation/romlab/out/verify7/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY = 0x11F2A
local SENTINEL = 0x0FFFF0
local DEST = 0x210000
local STACK = 0x3E2000

local CASES = {
  { n = "c0", src = 0x0D2610, pal = 176 }, { n = "c1", src = 0x0D8E05, pal = 176 },
  { n = "c2", src = 0x0E6717, pal = 240 }, { n = "c3", src = 0x0E5930, pal = 144 },
  { n = "c4", src = 0x0E5930, pal = 176 }, { n = "c5", src = 0x0E5D90, pal = 176 },
  { n = "c6", src = 0x0F2C80, pal = 128 }, { n = "c7", src = 0x0F1DC3, pal = 176 },
  { n = "c8", src = 0x0DE18B, pal = 48 },
}
local REGS = { "D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR" }
local frame, ci, saved, returned = 0, 1, nil, false
local phase = "idle"

local function save_state()
  local s = {}
  for _, r in ipairs(REGS) do
    local ok, v = pcall(function() return cpu.state[r].value end)
    if ok then s[r] = v end
  end
  return s
end
local function restore_state(s)
  for _, r in ipairs(REGS) do if s[r] then pcall(function() cpu.state[r].value = s[r] end) end end
end
local function install()
  TAPS[#TAPS+1] = space:install_read_tap(SENTINEL, SENTINEL+1, "d", function(o,d,m) returned = true; return d end)
end
local function start_case(c)
  saved = save_state()
  for i = 0, 4095 do space:write_u8(DEST + i, 0) end
  local sp = STACK - 4
  space:write_u32(sp, SENTINEL)
  cpu.state["SP"].value = sp
  cpu.state["A0"].value = c.src
  cpu.state["A1"].value = DEST
  cpu.state["D2"].value = c.pal
  cpu.state["D4"].value = 7
  cpu.state["PC"].value = ENTRY
  returned = false
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install(); phase = "run"; return end
  if phase ~= "run" then return end
  if ci > #CASES then log:write("done"..NL); log:flush(); manager.machine:exit(); return end
  local c = CASES[ci]
  if not saved then start_case(c); return end
  if returned then
    local parts = {}
    for row = 0, 7 do for col = 0, 7 do
      parts[#parts+1] = string.format("%02X", space:read_u8(DEST + row*512 + col))
    end end
    log:write(string.format("R %06X %d %s", c.src, c.pal, table.concat(parts))..NL)
  else
    log:write(string.format("R %06X %d NORETURN", c.src, c.pal)..NL)
  end
  log:flush(); restore_state(saved); saved = nil; ci = ci + 1
end)
