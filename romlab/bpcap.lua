-- UNFINISHED. This crashes MAME - the process dies during the first case, with
-- three cases or with four hundred, so it is the way the debugger is being
-- driven rather than anything about scale. Committed because the diagnosis it
-- exists to act on is worth keeping, and because the next person to try should
-- know this shape of it does not work.
--
-- Capture state at a true instruction boundary, using a breakpoint.
--
-- The tap-based capture reads registers from inside a memory access, and an
-- instruction can access memory more than once, so the state can be from
-- part-way through one. 0x441C is the clear case: the chip is "at"
-- `move.b (a1)+, (a0)+` with a1 already incremented and a0 not, which is no
-- instruction boundary at all and which a port that executes instructions
-- atomically can never reproduce.
--
-- A breakpoint stops the chip before an instruction executes, which is exactly
-- the boundary the port compares at. This re-takes the snapshots that the tap
-- could not read cleanly.
local OUT = "D:/repos/crenellation/romlab/out/bp/"
local log = io.open(OUT .. "b.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local dbg = cpu.debug
local mdbg = manager.machine.debugger

local SENTINEL = 0x3E6000
local PARK = 0x60FE
local RAM_LO, RAM_HI = 0x3E0000, 0x3FFFFF
local PF_LO, PF_HI = 0x200000, 0x21FFFF
local SCRATCH = 0x3E4000
local SCRATCH_LEN = 0x400
local STACK = 0x3E5000
local START = 2400

local STRUCTS = {
  0x3E0864, 0x3E1968, 0x3E1CF6, 0x3E1BC6, 0x3E0F48, 0x3E02D8, 0x3E4000,
}

local seed = 0x12345678
local function rnd()
  seed = seed ~ ((seed << 13) & 0xFFFFFFFF)
  seed = seed & 0xFFFFFFFF
  seed = seed ~ (seed >> 17)
  seed = seed ~ ((seed << 5) & 0xFFFFFFFF)
  seed = seed & 0xFFFFFFFF
  return seed
end

-- cases: "<entry> <shape> <stopping pc>", one per line
local cases = {}
do
  local f = io.open(OUT .. "cases.txt", "r")
  for line in f:lines() do
    local e, sh, pc = line:match("^(%x+)%s+(%d+)%s+(%x+)")
    if e then
      cases[#cases + 1] = { entry = tonumber(e, 16), shape = tonumber(sh),
                            pc = tonumber(pc, 16) }
    end
  end
  f:close()
end

-- the generator has to be advanced once per entry per shape, in the same order
-- the other captures used, or the arguments do not match
local entries = {}
do
  local f = io.open("D:/repos/crenellation/romlab/out/entries.txt", "r")
  for line in f:lines() do
    local v = tonumber(line:match("^(%x+)"), 16)
    if v then entries[#entries + 1] = v end
  end
  f:close()
end

local baseline, pfbase = {}, {}
local frame = 0
local phase = "boot"
local shape, ei = 0, 1
local inputs = {}
local bp = nil
local pending = nil
local caseAt = {}

local function dump_baseline()
  for a = RAM_LO, RAM_HI do baseline[a] = space:read_u8(a) end
  for a = PF_LO, PF_HI do pfbase[a] = space:read_u8(a) end
end

local function restore()
  for a = RAM_LO, RAM_HI do space:write_u8(a, baseline[a]) end
  for a = PF_LO, PF_HI do space:write_u8(a, pfbase[a]) end
end

local function gen(sh)
  local d, a = {}, {}
  for i = 0, SCRATCH_LEN - 1 do space:write_u8(SCRATCH + i, rnd() % 256) end
  for k = 0, 7 do
    local r = rnd()
    if sh == 0 then d[k] = r % 0x10000
    elseif sh == 1 then d[k] = r % 32
    else d[k] = r % 256 end
  end
  for k = 0, 5 do
    local r = rnd()
    if sh == 0 then a[k] = SCRATCH + (r % (SCRATCH_LEN - 0x80))
    else a[k] = STRUCTS[(r % #STRUCTS) + 1] end
  end
  local sp = STACK
  for k = 1, 4 do
    sp = sp - 4
    local v = (k % 2 == 0) and (rnd() % 0x100)
              or (SCRATCH + (rnd() % (SCRATCH_LEN - 0x80)))
    space:write_u32(sp, v)
  end
  sp = sp - 4
  space:write_u32(sp, SENTINEL)
  return d, a, sp
end

local function snapshot(c)
  local parts = {}
  for k = 0, 7 do parts[#parts + 1] = string.format("%08X", cpu.state["D" .. k].value % 0x100000000) end
  for k = 0, 6 do parts[#parts + 1] = string.format("%08X", cpu.state["A" .. k].value % 0x100000000) end
  local h = 0
  for i = 0, 0x1FFF do h = (h * 31 + space:read_u8(SCRATCH + i)) & 0xFFFFFFFF end
  parts[#parts + 1] = string.format("%08X", h)
  log:write(string.format("B %05X %d %05X %s", c.entry, c.shape, c.pc,
    table.concat(parts, " ")) .. NL)
end

local idx = 1

local function start_case()
  while idx <= #cases do
    local c = cases[idx]
    restore()
    space:write_u16(SENTINEL, PARK)
    -- advance the generator exactly as the other captures do, so this case
    -- sees the arguments it saw there
    local d, a, sp
    for i = 1, #entries do
      d, a, sp = gen(c.shape)
      if entries[i] == c.entry then break end
    end
    for k = 0, 7 do cpu.state["D" .. k].value = d[k] end
    for k = 0, 5 do cpu.state["A" .. k].value = a[k] end
    cpu.state["SP"].value = sp
    cpu.state["A6"].value = STACK + 0x200
    cpu.state["SR"].value = 0x2700
    cpu.state["PC"].value = c.entry
    if bp then dbg:bpclear(bp) end
    bp = dbg:bpset(c.pc)
    pending = c
    mdbg.execution_state = "run"
    return
  end
  log:write("done " .. (idx - 1) .. NL)
  log:flush()
  manager.machine:exit()
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame < START then
    local c = frame % 240
    local function set(pt, f, v)
      local q = manager.machine.ioport.ports[pt]
      local fl = q and q.fields[f]
      if fl then pcall(function() fl:set_value(v) end) end
    end
    if c == 0 then set(":IN1", "Coin 1", 1) end
    if c == 20 then set(":IN1", "Coin 1", 0) end
    if c == 40 then set(":IN1", "P1 Button 1", 1) end
    if c == 50 then set(":IN1", "P1 Button 1", 0) end
    return
  end
  if frame == START then
    dump_baseline()
    seed = 0x12345678
    start_case()
    return
  end
  if pending == nil then return end
  -- the breakpoint stops execution; that is the boundary to read
  if mdbg.execution_state == "stop" then
    if cpu.state["PC"].value == pending.pc then snapshot(pending) end
    idx = idx + 1
    seed = 0x12345678
    start_case()
  elseif frame % 4 == 0 then
    -- never reached it within a few frames
    idx = idx + 1
    seed = 0x12345678
    start_case()
  end
end)
