-- stepstate.lua for the entries that have no captures yet.
--
-- Identical harness, three deliberate differences: the entry list is
-- out/step/entries-new.txt (the 82 routines the map gained after the original
-- capture session), the log is sn<shape>-<steps>.log so nothing existing is
-- touched, and alongside the io snapshot it writes io-track.bin - the eight
-- bytes at 0x6C0000, the input latches the original block list left out,
-- which is why every routine that reads them is stuck in the ledger as
-- stepStateOnlyMismatch. The machine is frozen for the whole session, so one
-- snapshot of the latches covers every case.
--
-- The baselines are written to ram-baseline2.bin / pf-baseline2.bin /
-- io-baseline2.bin, never over the originals: if determinism holds they come
-- out byte-identical to the committed step-*.bin files, and that equality is
-- checked before a single new S-line is believed.
local OUT = "D:/repos/crenellation/romlab/out/step/"
local STEPS_ENV = os.getenv("STEPN") or "200"
local SHAPE = tonumber(os.getenv("STEPSHAPE") or "1")
local log = io.open(OUT .. "sn" .. SHAPE .. "-" .. STEPS_ENV .. ".log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}

local SENTINEL = 0x3E6000
local PARK = 0x60FE
local RAM_LO, RAM_HI = 0x3E0000, 0x3FFFFF
local PF_LO, PF_HI = 0x200000, 0x21FFFF
local SCRATCH = 0x3E4000
local SCRATCH_LEN = 0x400
local STACK = 0x3E5000
local START = 2400
local STEPS = tonumber(STEPS_ENV)

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

local entries = {}
do
  local f = io.open(OUT .. "entries-new.txt", "r")
  for line in f:lines() do
    local v = tonumber(line:match("^(%x+)"), 16)
    if v then entries[#entries + 1] = v end
  end
  f:close()
end

local baseline, pfbase = {}, {}
local frame, idx = 0, 1
local running, finished = false, false
local startedFrame = 0
local steps, lastpc = 0, -1
local snap = nil

local function dump_baseline()
  for a = RAM_LO, RAM_HI do baseline[a] = space:read_u8(a) end
  for a = PF_LO, PF_HI do pfbase[a] = space:read_u8(a) end
  local t = {}
  for a = RAM_LO, RAM_HI do t[#t + 1] = string.char(baseline[a]) end
  local fh = io.open(OUT .. "ram-baseline2.bin", "wb"); fh:write(table.concat(t)); fh:close()
  t = {}
  for a = PF_LO, PF_HI do t[#t + 1] = string.char(pfbase[a]) end
  fh = io.open(OUT .. "pf-baseline2.bin", "wb"); fh:write(table.concat(t)); fh:close()
end

local IO_BLOCKS = {
  {0x3C0000, 0x1000}, {0x460000, 0x1000}, {0x480000, 0x1000}, {0x640000, 0x1000},
  {0x140000, 0x40000}, {0x500000, 0x20000},
}

local function dump_io()
  local t = {}
  for _, blk in ipairs(IO_BLOCKS) do
    for i = 0, blk[2] - 1 do t[#t + 1] = string.char(space:read_u8(blk[1] + i)) end
  end
  local fh = io.open(OUT .. "io-baseline2.bin", "wb")
  fh:write(table.concat(t)); fh:close()
  t = {}
  for i = 0, 7 do t[#t + 1] = string.char(space:read_u8(0x6C0000 + i)) end
  fh = io.open(OUT .. "io-track.bin", "wb")
  fh:write(table.concat(t)); fh:close()
end

local function restore()
  for a = RAM_LO, RAM_HI do space:write_u8(a, baseline[a]) end
  for a = PF_LO, PF_HI do space:write_u8(a, pfbase[a]) end
end

local function take_snapshot()
  local parts = {}
  parts[#parts + 1] = string.format("%05X", cpu.state["CURPC"].value)
  for k = 0, 7 do parts[#parts + 1] = string.format("%08X", cpu.state["D" .. k].value % 0x100000000) end
  for k = 0, 6 do parts[#parts + 1] = string.format("%08X", cpu.state["A" .. k].value % 0x100000000) end
  local h = 0
  for i = 0, 0x1FFF do h = (h * 31 + space:read_u8(SCRATCH + i)) & 0xFFFFFFFF end
  parts[#parts + 1] = string.format("%08X", h)
  return table.concat(parts, " ")
end

local function begin_case()
  if idx > #entries then
    if not finished then
      finished = true
      log:write("done " .. (idx - 1) .. NL); log:flush(); manager.machine:exit()
    end
    return
  end
  restore()
  space:write_u16(SENTINEL, PARK)
  for i = 0, SCRATCH_LEN - 1 do space:write_u8(SCRATCH + i, rnd() % 256) end
  for k = 0, 7 do
    local r = rnd()
    local v
    if SHAPE == 0 then v = r % 0x10000
    elseif SHAPE == 1 or SHAPE == 3 then v = r % 32
    else v = r % 256 end
    cpu.state["D" .. k].value = v
  end
  for k = 0, 5 do
    local r = rnd()
    if SHAPE == 0 then
      cpu.state["A" .. k].value = SCRATCH + (r % (SCRATCH_LEN - 0x80))
    else
      cpu.state["A" .. k].value = STRUCTS[(r % #STRUCTS) + 1]
    end
  end
  local sp = STACK
  for k = 1, 4 do
    sp = sp - 4
    local r = rnd()
    local v
    if SHAPE == 3 then
      v = STRUCTS[(r % #STRUCTS) + 1]
    elseif k % 2 == 0 then
      v = r % 0x100
    else
      v = SCRATCH + (r % (SCRATCH_LEN - 0x80))
    end
    space:write_u32(sp, v)
  end
  sp = sp - 4
  space:write_u32(sp, SENTINEL)
  cpu.state["SP"].value = sp
  cpu.state["A6"].value = STACK + 0x200
  cpu.state["SR"].value = 0x2700
  cpu.state["PC"].value = entries[idx]
  steps, lastpc, snap = 0, -1, nil
  running = true
  startedFrame = frame
end

local function record()
  if snap == nil and steps <= 3 then
    snap = take_snapshot()
  end
  if snap then
    log:write(string.format("S %05X %d %d %s", entries[idx], SHAPE, STEPS, snap) .. NL)
  else
    log:write(string.format("X %05X %d", entries[idx], steps) .. NL)
  end
  idx = idx + 1
end

local function install()
  TAPS[#TAPS + 1] = space:install_read_tap(0x000000, 0x0FFFFF, "step",
    function(offset, d, mask)
      if not running then return d end
      local pc = cpu.state["CURPC"].value
      if pc ~= lastpc then
        lastpc = pc
        steps = steps + 1
        if steps > STEPS then
          snap = take_snapshot()
          running = false
        end
      end
      return d
    end)
end

emu.register_frame_done(function()
  frame = frame + 1
  if space then space:write_u16(0x72FFFE, 0) end
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
    dump_baseline(); dump_io(); install(); begin_case(); return
  end
  if finished then return end
  if frame > startedFrame then
    running = false
    record()
    begin_case()
  end
end)
