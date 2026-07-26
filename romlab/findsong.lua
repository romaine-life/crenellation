-- Find the "play song N" request variable.
--
-- Watch YM2413 activity; when writes resume after a silence, a song has just
-- started. Dump the work-RAM writes from the moments just before that instant
-- -- the song selector must be among them. Also record the PC of the code
-- driving the FM chip (the sound driver) for reference.
local OUT = "D:/repos/crenellation/romlab/out/song/"
local log = io.open(OUT .. "findsong.log", "w")
local NL = string.char(10)
local frame = 0

local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}

local RAM_LO, RAM_HI = 0x3E0000, 0x3E3FFF
local recent = {}      -- rolling buffer of recent RAM writes
local RECENT_MAX = 4000
local last_ym = -100
local starts = 0
local driver_pcs = {}

local function now()
  local t = manager.machine.time
  local ok, v = pcall(function() return t:as_double() end)
  if ok then return v end
  return t.seconds
end

local function install()
  TAPS[#TAPS + 1] = space:install_write_tap(RAM_LO, RAM_HI, "ram", function(offset, data, mask)
    local v = data & 0xFF
    recent[#recent + 1] = { a = offset, v = v, t = now() }
    if #recent > RECENT_MAX then table.remove(recent, 1) end
    return data
  end)

  TAPS[#TAPS + 1] = space:install_write_tap(0x480000, 0x499fff, "ym", function(offset, data, mask)
    local t = now()
    local pc = cpu.state["PC"].value
    driver_pcs[pc] = (driver_pcs[pc] or 0) + 1
    if t - last_ym > 2.0 then
      starts = starts + 1
      log:write(string.format("=== song start %d at t=%.3f ===", starts, t) .. NL)
      -- RAM writes in the 0.4s before the music began.
      local n = 0
      for i = #recent, 1, -1 do
        local r = recent[i]
        if t - r.t > 0.4 then break end
        if r.v <= 32 then
          log:write(string.format("   %06X = %02X  (%.3fs before)", r.a, r.v, t - r.t) .. NL)
          n = n + 1
          if n > 40 then break end
        end
      end
      log:flush()
    end
    last_ym = t
    return data
  end)
  log:write("taps installed" .. NL)
  log:flush()
end

local function fld(p, n)
  local port = manager.machine.ioport.ports[p]
  return port and port.fields[n] or nil
end
local function set(p, n, v)
  local f = fld(p, n)
  if f then pcall(function() f:set_value(v) end) end
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install() end
  if frame > 650 then
    local c = frame % 240
    if c == 0 then set(":IN1", "Coin 1", 1) end
    if c == 20 then set(":IN1", "Coin 1", 0) end
    local q = frame % 30
    if q == 0 then set(":IN1", "P1 Button 1", 1); set(":IN0", "P2 Button 1", 1) end
    if q == 8 then set(":IN1", "P1 Button 1", 0); set(":IN0", "P2 Button 1", 0) end
  end
  if frame == 42000 then
    local list = {}
    for pc, n in pairs(driver_pcs) do list[#list + 1] = { pc = pc, n = n } end
    table.sort(list, function(a, b) return a.n > b.n end)
    log:write(NL .. "sound-driver PCs writing the YM2413:" .. NL)
    for i = 1, math.min(#list, 10) do
      log:write(string.format("   PC %06X  %d writes", list[i].pc, list[i].n) .. NL)
    end
    log:flush()
    manager.machine:exit()
  end
end)
