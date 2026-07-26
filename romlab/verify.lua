-- Verification harness: call a 68000 routine in the emulator with controlled
-- inputs, capture its output, and dump it for comparison against the port.
--
-- Calling convention used here: save CPU state, point the stack at scratch,
-- push a sentinel return address, set registers, set PC to the routine, then
-- let it run. A read tap on the sentinel fires when the routine RTSes to it,
-- at which point the output is read and the original CPU state restored.
--
-- Target: the graphics decompressor's inner loop at 0x11F2A.
--   a0 = compressed source, a1 = destination, d2 = palette base,
--   d4 = 7 (pixels left in the 8px row), d3 = 0
local OUT = "D:/repos/crenellation/romlab/out/verify/"
local log = io.open(OUT .. "verify.log", "w")
local NL = string.char(10)

local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}

local SENTINEL = 0x0FFFF0        -- unused ROM address; fetching it means "returned"
local DEST = 0x210000            -- inside bitmap RAM, safely past the visible area
local STACK = 0x3E2000           -- scratch stack

-- Sources to decode, chosen from addresses the game itself passes to the
-- routine plus the bank bases.
local CASES = {
  { name = "call000", src = 0xE68C6, pal = 240, d4 = 7 },
  { name = "call001", src = 0xE653E, pal = 240, d4 = 7 },
  { name = "call002", src = 0xE6292, pal = 240, d4 = 7 },
  { name = "call003", src = 0xE4E84, pal = 192, d4 = 7 },
  { name = "call004", src = 0xE4FB4, pal = 192, d4 = 7 },
  { name = "call005", src = 0xD75E0, pal = 48, d4 = 7 },
  { name = "call006", src = 0xE6459, pal = 240, d4 = 7 },
  { name = "call007", src = 0xE69B2, pal = 240, d4 = 7 },
  { name = "call008", src = 0xE6AB3, pal = 240, d4 = 7 },
  { name = "call009", src = 0xD7B51, pal = 32, d4 = 7 },
  { name = "call010", src = 0xE6447, pal = 240, d4 = 7 },
  { name = "call011", src = 0xD7760, pal = 48, d4 = 7 },
  { name = "call012", src = 0xE656A, pal = 240, d4 = 7 },
  { name = "call013", src = 0xE4D12, pal = 192, d4 = 7 },
  { name = "call014", src = 0xE64BB, pal = 240, d4 = 7 },
  { name = "call015", src = 0xE6900, pal = 240, d4 = 7 },
  { name = "call016", src = 0xE50AA, pal = 192, d4 = 7 },
  { name = "call017", src = 0xE694C, pal = 240, d4 = 7 },
  { name = "call018", src = 0xE64EE, pal = 240, d4 = 7 },
  { name = "call019", src = 0xE5062, pal = 192, d4 = 7 },
  { name = "call020", src = 0xE69E5, pal = 240, d4 = 7 },
  { name = "call021", src = 0xE6984, pal = 240, d4 = 7 },
  { name = "call022", src = 0xE4E00, pal = 192, d4 = 7 },
  { name = "call023", src = 0xD76BA, pal = 48, d4 = 7 },
  { name = "call024", src = 0xD7AC8, pal = 32, d4 = 7 },
  { name = "call025", src = 0xD7AF5, pal = 32, d4 = 7 },
  { name = "call026", src = 0xE555A, pal = 192, d4 = 7 },
  { name = "call027", src = 0xE6822, pal = 240, d4 = 7 },
  { name = "call028", src = 0xE633D, pal = 240, d4 = 7 },
  { name = "call029", src = 0xD770C, pal = 48, d4 = 7 },
  { name = "call030", src = 0xE6727, pal = 240, d4 = 7 },
  { name = "call031", src = 0xE6489, pal = 240, d4 = 7 },
  { name = "call032", src = 0xE4FE2, pal = 192, d4 = 7 },
  { name = "call033", src = 0xE675B, pal = 240, d4 = 7 },
  { name = "call034", src = 0xE6A99, pal = 240, d4 = 7 },
  { name = "call035", src = 0xD7AB1, pal = 32, d4 = 7 },
  { name = "call036", src = 0xE4EBA, pal = 192, d4 = 7 },
  { name = "call037", src = 0xE4D95, pal = 192, d4 = 7 },
  { name = "call038", src = 0xE6A21, pal = 240, d4 = 7 },
  { name = "call039", src = 0xE4DCC, pal = 192, d4 = 7 },
  { name = "call040", src = 0xE6918, pal = 240, d4 = 7 },
  { name = "call041", src = 0xE504F, pal = 192, d4 = 7 },
  { name = "call042", src = 0xD7787, pal = 48, d4 = 7 },
  { name = "call043", src = 0xE4E68, pal = 192, d4 = 7 },
  { name = "call044", src = 0xE6775, pal = 240, d4 = 7 },
  { name = "call045", src = 0xE4FFE, pal = 192, d4 = 7 },
  { name = "call046", src = 0xE6A6F, pal = 240, d4 = 7 },
  { name = "call047", src = 0xE4F4E, pal = 192, d4 = 7 },
  { name = "call048", src = 0xD7672, pal = 48, d4 = 7 },
  { name = "call049", src = 0xE4D7B, pal = 192, d4 = 7 },
  { name = "call050", src = 0xD75BB, pal = 48, d4 = 7 },
  { name = "call051", src = 0xE5031, pal = 192, d4 = 7 },
  { name = "call052", src = 0xD76E4, pal = 48, d4 = 7 },
  { name = "call053", src = 0xE4FCB, pal = 192, d4 = 7 },
  { name = "call054", src = 0xE5525, pal = 192, d4 = 7 },
  { name = "call055", src = 0xD7B0E, pal = 32, d4 = 7 },
  { name = "call056", src = 0xD7631, pal = 48, d4 = 7 },
  { name = "call057", src = 0xE68B6, pal = 240, d4 = 7 },
  { name = "call058", src = 0xE68EA, pal = 240, d4 = 7 },
  { name = "call059", src = 0xE6886, pal = 240, d4 = 7 },
  { name = "call060", src = 0xE635E, pal = 240, d4 = 7 },
  { name = "call061", src = 0xE64A6, pal = 240, d4 = 7 },
  { name = "call062", src = 0xD7ADC, pal = 32, d4 = 7 },
  { name = "call063", src = 0xE631F, pal = 240, d4 = 7 },
  { name = "call064", src = 0xE6968, pal = 240, d4 = 7 },
  { name = "call065", src = 0xE683C, pal = 240, d4 = 7 },
  { name = "call066", src = 0xE4F31, pal = 192, d4 = 7 },
  { name = "call067", src = 0xE6A3D, pal = 240, d4 = 7 },
  { name = "call068", src = 0xE6A07, pal = 240, d4 = 7 },
  { name = "call069", src = 0xE6429, pal = 240, d4 = 7 },
  { name = "call070", src = 0xE62AA, pal = 240, d4 = 7 },
  { name = "call071", src = 0xD760A, pal = 48, d4 = 7 },
  { name = "call072", src = 0xE6850, pal = 240, d4 = 7 },
  { name = "call073", src = 0xE62C8, pal = 240, d4 = 7 },
  { name = "call074", src = 0xE553F, pal = 192, d4 = 7 },
  { name = "call075", src = 0xE63B0, pal = 240, d4 = 7 },
  { name = "call076", src = 0xE6587, pal = 240, d4 = 7 },
  { name = "call077", src = 0xD7656, pal = 48, d4 = 7 },
  { name = "call078", src = 0xE5751, pal = 192, d4 = 7 },
  { name = "call079", src = 0xD77A7, pal = 48, d4 = 7 },
  { name = "call080", src = 0xE4EFE, pal = 192, d4 = 7 },
  { name = "call081", src = 0xE67C5, pal = 240, d4 = 7 },
  { name = "call082", src = 0xE64D8, pal = 240, d4 = 7 },
  { name = "call083", src = 0xE4F63, pal = 192, d4 = 7 },
  { name = "call084", src = 0xE678F, pal = 240, d4 = 7 },
  { name = "call085", src = 0xD7736, pal = 48, d4 = 7 },
  { name = "call086", src = 0xE699A, pal = 240, d4 = 7 },
  { name = "call087", src = 0xE4ECE, pal = 192, d4 = 7 },
  { name = "call088", src = 0xE4F94, pal = 192, d4 = 7 },
  { name = "call089", src = 0xE6A89, pal = 240, d4 = 7 },
}

local frame = 0
local phase = "idle"
local caseIdx = 1
local saved = nil
local returned = false

local REGS = { "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "SP", "PC", "SR" }

local function save_state()
  local s = {}
  for _, r in ipairs(REGS) do
    local ok, v = pcall(function() return cpu.state[r].value end)
    if ok then s[r] = v end
  end
  return s
end

local function restore_state(s)
  for _, r in ipairs(REGS) do
    if s[r] then pcall(function() cpu.state[r].value = s[r] end) end
  end
end

local function install()
  TAPS[#TAPS + 1] = space:install_read_tap(SENTINEL, SENTINEL + 1, "done", function(offset, data, mask)
    returned = true
    return data
  end)
  log:write("sentinel tap installed" .. NL)
  log:flush()
end

local function dump_output(name, bytes)
  local t = {}
  for i = 0, bytes - 1 do
    t[#t + 1] = string.char(space:read_u8(DEST + i))
  end
  local fh = io.open(OUT .. name .. ".bin", "wb")
  fh:write(table.concat(t))
  fh:close()
end

local function start_case(c)
  saved = save_state()
  -- clear the destination so leftover pixels can't be mistaken for output
  for i = 0, 8191 do space:write_u8(DEST + i, 0) end
  local sp = STACK
  -- push the sentinel as the return address
  sp = sp - 4
  space:write_u32(sp, SENTINEL)
  cpu.state["SP"].value = sp
  cpu.state["A0"].value = c.src
  cpu.state["A1"].value = DEST
  cpu.state["D1"].value = 0
  cpu.state["D2"].value = c.pal
  cpu.state["D3"].value = 0
  cpu.state["D4"].value = c.d4 or 7
  cpu.state["PC"].value = 0x11F2A
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
    log:write("all cases done" .. NL)
    log:flush()
    manager.machine:exit()
    return
  end

  local c = CASES[caseIdx]
  if not saved then
    start_case(c)
    log:write(string.format("case %s: src=%06X pal=%d", c.name, c.src, c.pal) .. NL)
    log:flush()
    return
  end

  -- one frame of execution is far more than the routine needs
  if returned then
    dump_output(c.name, 8192)
    log:write(string.format("  returned, output written (%s.bin)", c.name) .. NL)
  else
    log:write(string.format("  DID NOT RETURN within a frame (pc=%06X)", cpu.state["PC"].value) .. NL)
  end
  log:flush()
  restore_state(saved)
  saved = nil
  caseIdx = caseIdx + 1
end)
