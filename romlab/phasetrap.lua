-- Trace instruction execution across a phase transition.
--
-- The routines that run enclosure and scoring only execute when a phase ends.
-- Watching the countdown at 0x3E1870 reach zero gives an exact trigger: trace
-- the frames around it, trace a quiet mid-phase frame as a baseline, and the
-- difference is the transition logic.
--
-- An instruction fetch is a read in program space, so a read tap over the code
-- region records executed addresses. That is far too slow to leave on, but it
-- is affordable for a handful of frames.
local OUT = "D:/repos/crenellation/romlab/out/phasetrap/"
local log = io.open(OUT .. "p.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local frame, tx, ty = 0, 0, 0
local trace = nil          -- pc -> count while tracing
local tracing_left = 0
local label = ""
local prev_cd = -1
local done_base, done_trans = false, false
local codetap = nil

local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end

local function code_tap_on()
  trace = {}
  codetap = space:install_read_tap(0x000000, 0x02FFFF, "code", function(offset, data, mask)
    local pc = cpu.state["CURPC"].value
    local e = trace[pc]
    if e then trace[pc] = e + 1 else trace[pc] = 1 end
    return data
  end)
end

local function code_tap_off(tag)
  if codetap then codetap:remove(); codetap = nil end
  local n = 0
  for pc, c in pairs(trace) do
    log:write(string.format("%s %06X %d", tag, pc, c)..NL)
    n = n + 1
  end
  log:write(string.format("# %s addresses %d", tag, n)..NL)
  log:flush()
  trace = nil
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame > 600 and frame < 9000 then
    local c = frame % 240
    if c == 0 then set(":IN1","Coin 1",1) end
    if c == 20 then set(":IN1","Coin 1",0) end
    if c == 40 then set(":IN1","P1 Button 1",1) end
    if c == 50 then set(":IN1","P1 Button 1",0) end
  end
  if frame > 900 then
    tx=(tx+7)%256; ty=(ty+11)%256
    set(":TRACK3","Trackball X",tx); set(":TRACK2","Trackball Y",ty)
    local q = frame % 45
    if q == 0 then set(":IN1","P1 Button 1",1) end
    if q == 6 then set(":IN1","P1 Button 1",0) end
  end

  if tracing_left > 0 then
    tracing_left = tracing_left - 1
    if tracing_left == 0 then code_tap_off(label) end
    return
  end

  local cd = space:read_u8(0x3E1870)
  -- baseline: a quiet frame in the middle of a countdown
  if not done_base and frame > 2000 and cd >= 8 and cd <= 12 then
    done_base = true; label = "BASE"; code_tap_on(); tracing_left = 2
    log:write(string.format("# BASE at frame %d cd %d", frame, cd)..NL); log:flush()
    prev_cd = cd; return
  end
  -- transition: the countdown just hit zero
  if done_base and not done_trans and prev_cd == 1 and cd == 0 then
    done_trans = true; label = "TRANS"; code_tap_on(); tracing_left = 4
    log:write(string.format("# TRANS at frame %d", frame)..NL); log:flush()
    prev_cd = cd; return
  end
  prev_cd = cd
  if frame == 9600 or (done_base and done_trans and tracing_left == 0) then
    log:write("done"..NL); log:flush(); manager.machine:exit()
  end
end)
