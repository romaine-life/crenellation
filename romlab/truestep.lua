-- Capture state at a true instruction boundary by single-stepping the chip.
--
-- Every other capture here reads registers from inside a memory tap, which
-- fires part-way through an instruction. For most routines that is fine - the
-- recorded address agrees with the instruction stream 97% of the time - but the
-- routines that still do not verify sit disproportionately in the other 3%, and
-- two of them were taken apart far enough to show a recorded program counter
-- that cannot be reconciled with the registers beside it.
--
-- MAME's debugger can single-step under `-debug -debugger none`. A breakpoint
-- does not halt the machine there, but `step()` advances exactly one
-- instruction, and the state after it is a genuine boundary. It costs a frame
-- per instruction, so this runs only for the routines that need it.
local OUT = "D:/repos/crenellation/romlab/out/true/"
local log = io.open(OUT .. "t.log", "w")
local NL = string.char(10)

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

local cpu, space, dbg, mdbg

local seed = 0x12345678
local function rnd()
  seed = seed ~ ((seed << 13) & 0xFFFFFFFF)
  seed = seed & 0xFFFFFFFF
  seed = seed ~ (seed >> 17)
  seed = seed ~ ((seed << 5) & 0xFFFFFFFF)
  seed = seed & 0xFFFFFFFF
  return seed
end

-- "<entry> <shape> <steps>", one per line
local cases = {}
do
  local f = io.open(OUT .. "cases.txt", "r")
  for line in f:lines() do
    local e, sh, n = line:match("^(%x+)%s+(%d+)%s+(%d+)")
    if e then
      cases[#cases + 1] = { entry = tonumber(e, 16), shape = tonumber(sh),
                            steps = tonumber(n) }
    end
  end
  f:close()
end

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
local frame, idx, left = 0, 1, -1
local finished = false

local function dump_baseline()
  local t = {}
  for a = RAM_LO, RAM_HI do baseline[a] = space:read_u8(a); t[#t+1] = string.char(baseline[a]) end
  local fh = io.open(OUT .. "ram-baseline.bin", "wb"); fh:write(table.concat(t)); fh:close()
  t = {}
  for a = PF_LO, PF_HI do pfbase[a] = space:read_u8(a); t[#t+1] = string.char(pfbase[a]) end
  fh = io.open(OUT .. "pf-baseline.bin", "wb"); fh:write(table.concat(t)); fh:close()
end

local function restore()
  for a = RAM_LO, RAM_HI do space:write_u8(a, baseline[a]) end
  for a = PF_LO, PF_HI do space:write_u8(a, pfbase[a]) end
end

local function snapshot(c)
  -- CURPC, not PC: while the debugger has the machine stopped, PC is the
  -- prefetch pointer and reads one word ahead of the instruction about to run
  local parts = { string.format("%05X", cpu.state["CURPC"].value) }
  for k = 0, 7 do parts[#parts + 1] = string.format("%08X", cpu.state["D" .. k].value % 0x100000000) end
  for k = 0, 6 do parts[#parts + 1] = string.format("%08X", cpu.state["A" .. k].value % 0x100000000) end
  local h = 0
  for i = 0, 0x1FFF do h = (h * 31 + space:read_u8(SCRATCH + i)) & 0xFFFFFFFF end
  parts[#parts + 1] = string.format("%08X", h)
  log:write(string.format("T %05X %d %d %s", c.entry, c.shape, c.steps,
    table.concat(parts, " ")) .. NL)
  log:flush()
end

local function begin_case()
  if idx > #cases then
    if not finished then
      finished = true
      log:write("done " .. (idx - 1) .. NL); log:flush(); manager.machine:exit()
    end
    return
  end
  local c = cases[idx]
  restore()
  space:write_u16(SENTINEL, PARK)
  -- advance the generator exactly as the other captures do, so this case sees
  -- the arguments it saw there
  seed = 0x12345678
  local d, a, sp
  for i = 1, #entries do
    d, a = {}, {}
    for j = 0, SCRATCH_LEN - 1 do space:write_u8(SCRATCH + j, rnd() % 256) end
    for k = 0, 7 do
      local r = rnd()
      if c.shape == 0 then d[k] = r % 0x10000
      elseif c.shape == 1 or c.shape == 3 then d[k] = r % 32
      else d[k] = r % 256 end
    end
    for k = 0, 5 do
      local r = rnd()
      if c.shape == 0 then a[k] = SCRATCH + (r % (SCRATCH_LEN - 0x80))
      else a[k] = STRUCTS[(r % #STRUCTS) + 1] end
    end
    sp = STACK
    for k = 1, 4 do
      sp = sp - 4
      local r = rnd()
      local v
      if c.shape == 3 then v = STRUCTS[(r % #STRUCTS) + 1]
      elseif k % 2 == 0 then v = r % 0x100
      else v = SCRATCH + (r % (SCRATCH_LEN - 0x80)) end
      space:write_u32(sp, v)
    end
    if entries[i] == c.entry then break end
  end
  sp = sp - 4
  space:write_u32(sp, SENTINEL)
  for k = 0, 7 do cpu.state["D" .. k].value = d[k] end
  for k = 0, 5 do cpu.state["A" .. k].value = a[k] end
  cpu.state["SP"].value = sp
  cpu.state["A6"].value = STACK + 0x200
  cpu.state["SR"].value = 0x2700
  cpu.state["PC"].value = c.entry
  left = c.steps
end

emu.register_periodic(function()
  if left < 0 or finished then return end
  if left == 0 then
    snapshot(cases[idx])
    idx = idx + 1
    begin_case()
    return
  end
  left = left - 1
  dbg:step()
end)

emu.register_frame_done(function()
  frame = frame + 1
  if cpu == nil then
    cpu = manager.machine.devices[":maincpu"]
    space = cpu.spaces["program"]
    dbg = cpu.debug
    mdbg = manager.machine.debugger
  end
  space:write_u16(0x72FFFE, 0)          -- keep the watchdog fed
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
    mdbg.execution_state = "stop"
    begin_case()
  end
end)
