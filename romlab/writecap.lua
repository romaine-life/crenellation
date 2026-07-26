-- Verify a routine by what it writes, not by what it returns.
--
-- Every other harness here calls a routine and waits for it to come back to a
-- sentinel. 111 routines contain no rts at all - they end by jumping elsewhere,
-- or they are loops the game only leaves by interrupt - so no argument will
-- ever make them return and they cannot be judged that way.
--
-- They can still be judged. Starting from identical state, the sequence of
-- bytes a routine writes is as deterministic as the registers it ends with.
-- This records the first N byte-writes each one makes and the port is run
-- against that.
local OUT = "D:/repos/crenellation/romlab/out/write/"
local log = io.open(OUT .. "w.log", "w")
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
local MAXW = 48                -- writes recorded per case
local START = 2400
local SHAPE = tonumber(os.getenv("WRITESHAPE") or "1")

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
  local f = io.open("D:/repos/crenellation/romlab/out/write/entries.txt", "r")
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
local writes = {}
local taphits = 0

local function dump_baseline()
  for a = RAM_LO, RAM_HI do baseline[a] = space:read_u8(a) end
  for a = PF_LO, PF_HI do pfbase[a] = space:read_u8(a) end
  local t = {}
  for a = RAM_LO, RAM_HI do t[#t + 1] = string.char(baseline[a]) end
  local fh = io.open(OUT .. "ram-baseline.bin", "wb"); fh:write(table.concat(t)); fh:close()
  t = {}
  for a = PF_LO, PF_HI do t[#t + 1] = string.char(pfbase[a]) end
  fh = io.open(OUT .. "pf-baseline.bin", "wb"); fh:write(table.concat(t)); fh:close()
end

local function restore()
  for a = RAM_LO, RAM_HI do space:write_u8(a, baseline[a]) end
  for a = PF_LO, PF_HI do space:write_u8(a, pfbase[a]) end
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
    elseif SHAPE == 1 then v = r % 32
    else v = r % 256 end
    cpu.state["D" .. k].value = v
  end
  for k = 0, 5 do
    local r = rnd()
    local v
    if SHAPE == 0 then v = SCRATCH + (r % (SCRATCH_LEN - 0x80))
    else v = STRUCTS[(r % #STRUCTS) + 1] end
    cpu.state["A" .. k].value = v
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
  cpu.state["SP"].value = sp
  cpu.state["A6"].value = STACK + 0x200
  cpu.state["SR"].value = 0x2700
  cpu.state["PC"].value = entries[idx]
  writes = {}
  running = true
  startedFrame = frame
end

local function record()
  local parts = {}
  for i = 1, #writes do parts[#parts + 1] = writes[i] end
  log:write(string.format("W %05X %d %s", entries[idx], #writes,
    table.concat(parts, " ")) .. NL)
  if idx == 1 then log:write("# taphits after first case: " .. taphits .. NL) end
  idx = idx + 1
end

local function install()
  TAPS[#TAPS + 1] = space:install_read_tap(SENTINEL, SENTINEL + 1, "sent",
    function(o, d, mask) if running then running = false end return d end)
  -- A write tap on a 16-bit space reports the word address and a byte mask.
  -- Recording bytes rather than accesses keeps the two sides comparable
  -- without having to model the bus width.
  local function wtap(offset, data, mask)
      taphits = taphits + 1
      if running and #writes < MAXW then
        if (mask & 0xFF00) ~= 0 then
          writes[#writes + 1] = string.format("%06X:%02X", offset, (data >> 8) & 0xFF)
        end
        if (mask & 0x00FF) ~= 0 then
          writes[#writes + 1] = string.format("%06X:%02X", offset + 1, data & 0xFF)
        end
      end
      return data
  end
  TAPS[#TAPS + 1] = space:install_write_tap(RAM_LO, RAM_HI, "wr", wtap)
  TAPS[#TAPS + 1] = space:install_write_tap(PF_LO, PF_HI, "wp", wtap)
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
    install()
    begin_case()
    return
  end
  if finished then return end
  -- one frame per case whether or not it came back: what is being compared is
  -- the writes it made, not whether it finished
  if frame > startedFrame then
    running = false
    record()
    begin_case()
  end
end)
