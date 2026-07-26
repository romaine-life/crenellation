-- Trace one routine instruction by instruction on the real 68000.
--
-- Comparing only final state says a routine is wrong but not where. This logs
-- the program counter and registers before every instruction, so the port can
-- be run against it and the first differing step identified exactly.
--
-- The routine and its inputs come from the replay list, so the trace matches a
-- case the differential test already flags.
local OUT = "D:/repos/crenellation/romlab/out/step/"
local log = io.open(OUT .. "s.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}

local TARGET = tonumber(os.getenv("STEP_ENTRY") or "18a5e", 16)
local SENTINEL = 0x3E6000
local PARK = 0x60FE
local RAM_LO, RAM_HI = 0x3E0000, 0x3EFFFF
local STACK = 0x3E5000
local MAXSTEPS = 4000

local case = nil
do
  local f = io.open("D:/repos/crenellation/romlab/out/calls/replay.txt", "r")
  for line in f:lines() do
    local t = {}
    for w in line:gmatch("%S+") do t[#t + 1] = tonumber(w, 16) end
    if #t >= 24 and t[1] == TARGET and not case then
      case = { entry = t[1], d = { table.unpack(t, 2, 9) },
               a = { table.unpack(t, 10, 16) }, stk = { table.unpack(t, 17, 25) } }
    end
  end
  f:close()
end

local frame, steps = 0, 0
local tracing = false

local function install()
  TAPS[#TAPS + 1] = space:install_read_tap(0x000000, 0x01FFFF, "step",
    function(offset, d, mask)
      if not tracing then return d end
      local pc = cpu.state["CURPC"].value
      if pc == SENTINEL then tracing = false; return d end
      steps = steps + 1
      if steps > MAXSTEPS then tracing = false; return d end
      local p = {}
      for k = 0, 7 do p[#p + 1] = string.format("%08X", cpu.state["D" .. k].value % 0x100000000) end
      for k = 0, 7 do p[#p + 1] = string.format("%08X", cpu.state["A" .. k].value % 0x100000000) end
      log:write(string.format("%05X %s", pc, table.concat(p, " ")) .. NL)
      return d
    end)
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame ~= 400 then
    if frame > 402 then
      log:write("# steps " .. steps .. NL)
      log:flush()
      manager.machine:exit()
    end
    return
  end
  if not case then
    log:write("# no case for entry" .. NL); log:flush(); manager.machine:exit(); return
  end
  install()
  space:write_u16(SENTINEL, PARK)
  local sp = STACK
  for k = 8, 1, -1 do
    sp = sp - 4
    space:write_u32(sp, case.stk[k + 1])
  end
  sp = sp - 4
  space:write_u32(sp, SENTINEL)
  for k = 0, 7 do cpu.state["D" .. k].value = case.d[k + 1] end
  for k = 0, 5 do cpu.state["A" .. k].value = case.a[k + 1] end
  cpu.state["SP"].value = sp
  cpu.state["A6"].value = STACK + 0x200
  cpu.state["SR"].value = 0x2700
  cpu.state["PC"].value = case.entry
  tracing = true
end)
