-- Verify the SECOND decompressor (terrain painter) at 0x124BE.
--
-- Signature: func(long src @+4, long dest @+8). It is stateful: texture mode
-- reads a rotating offset from 0x3E0E76 and advances the low byte by 13 (mod
-- 64) on every use, so the state must be set identically before each call for
-- a comparison to mean anything.
local OUT = "D:/repos/crenellation/romlab/out/verify2/"
local log = io.open(OUT .. "verify2.log", "w")
local NL = string.char(10)

local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}

local ENTRY = 0x124BE
local SENTINEL = 0x0FFFF0
local DEST = 0x210000
local STACK = 0x3E2000
local ROT = 0x3E0E76          -- rotating texture offset (word)

local CASES = {
  { name = "t000", src = 0x05B4E0, rot = 0x0000 },
  { name = "t001", src = 0x05B4E0, rot = 0x0020 },
  { name = "t002", src = 0x05C270, rot = 0x0000 },
  { name = "t003", src = 0x05C258, rot = 0x0010 },
  { name = "t004", src = 0x05C254, rot = 0x0000 },
  { name = "t005", src = 0x09C900, rot = 0x0000 },
  { name = "t006", src = 0x09C980, rot = 0x0008 },
  { name = "t007", src = 0x09CA00, rot = 0x0000 },
  { name = "t008", src = 0x0A0000, rot = 0x0000 },
  { name = "t009", src = 0x0A0100, rot = 0x0030 },
}

local REGS = { "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "SP", "PC", "SR" }
local frame, caseIdx, saved, returned = 0, 1, nil, false
local phase = "idle"

local function save_state()
  local s = {}
  for _, r in ipairs(REGS) do
    local ok, v = pcall(function() return cpu.state[r].value end)
    if ok then s[r] = v end
  end
  s.rot = space:read_u16(ROT)
  return s
end

local function restore_state(s)
  for _, r in ipairs(REGS) do
    if s[r] then pcall(function() cpu.state[r].value = s[r] end) end
  end
  pcall(function() space:write_u16(ROT, s.rot) end)
end

local function install()
  TAPS[#TAPS + 1] = space:install_read_tap(SENTINEL, SENTINEL + 1, "done", function(offset, data, mask)
    returned = true
    return data
  end)
end

local function start_case(c)
  saved = save_state()
  for i = 0, 8191 do space:write_u8(DEST + i, 0) end
  space:write_u16(ROT, c.rot)
  local sp = STACK
  sp = sp - 4
  space:write_u32(sp, DEST)      -- arg2: destination
  sp = sp - 4
  space:write_u32(sp, c.src)     -- arg1: source
  sp = sp - 4
  space:write_u32(sp, SENTINEL)  -- return address
  cpu.state["SP"].value = sp
  cpu.state["PC"].value = ENTRY
  returned = false
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 300 then
    install()
    phase = "run"
    return
  end
  if phase ~= "run" then return end
  if caseIdx > #CASES then
    log:write("done" .. NL); log:flush()
    manager.machine:exit()
    return
  end
  local c = CASES[caseIdx]
  if not saved then
    start_case(c)
    log:write(string.format("case %s src=%06X rot=%04X", c.name, c.src, c.rot) .. NL)
    log:flush()
    return
  end
  if returned then
    local t = {}
    for i = 0, 8191 do t[#t + 1] = string.char(space:read_u8(DEST + i)) end
    local fh = io.open(OUT .. c.name .. ".bin", "wb")
    fh:write(table.concat(t)); fh:close()
    -- record the resulting rotation so the port's state update can be checked
    log:write(string.format("  ok rot_after=%04X", space:read_u16(ROT)) .. NL)
  else
    log:write(string.format("  NO RETURN pc=%06X", cpu.state["PC"].value) .. NL)
  end
  log:flush()
  restore_state(saved)
  saved = nil
  caseIdx = caseIdx + 1
end)
