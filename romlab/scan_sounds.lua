-- Probe every sound ID by injecting it into the game's own sound queue.
--
-- sound_queue(id) at 0x1A0CC writes an ID byte into a ring buffer:
--   queue 0x3E3D46..0x3E3D55, write pointer at 0x3E3D5A, read pointer 0x3E3D56.
-- Injecting directly means no game state is needed. Only YM2413 writes are
-- counted, so sample-chip sound effects can't contaminate the result.
local OUT = "D:/repos/crenellation/romlab/out/song/"
local log = io.open(OUT .. "scan.log", "w")
local NL = string.char(10)

local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}

local Q_LO, Q_HI = 0x3E3D46, 0x3E3D55
local WPTR, RPTR = 0x3E3D5A, 0x3E3D56

local ymcount = 0
local frame = 0
local id = 0
local MAX_ID = 255
local SETTLE = 40      -- frames of silence before injecting
local WINDOW = 150     -- frames to listen (2.5s)
local CYCLE = SETTLE + WINDOW
local started = 3000   -- let the machine boot and reach attract first
local results = {}

local function install()
  TAPS[#TAPS + 1] = space:install_write_tap(0x480000, 0x499fff, "ym", function(offset, data, mask)
    ymcount = ymcount + 1
    return data
  end)
  -- Swallow sample-chip writes entirely; nothing but FM should sound.
  TAPS[#TAPS + 1] = space:install_write_tap(0x460000, 0x479fff, "oki", function(offset, data, mask)
    return 0
  end)
  log:write("taps installed" .. NL)
  log:flush()
end

local function queue_sound(sid)
  local ok, err = pcall(function()
    local p = space:read_u32(WPTR)
    p = p + 1
    if p > Q_HI or p < Q_LO then p = Q_LO end
    space:write_u32(WPTR, p)
    space:write_u8(p, sid)
  end)
  if not ok then log:write("queue fail " .. tostring(err) .. NL) end
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install() end
  if frame < started then return end

  local t = (frame - started) % CYCLE
  if t == 0 then
    ymcount = 0
  elseif t == SETTLE then
    if id > MAX_ID then
      log:write(NL .. "sound IDs producing FM activity:" .. NL)
      for _, r in ipairs(results) do
        log:write(string.format("   id %3d (%02X): %d FM writes", r.id, r.id, r.n) .. NL)
      end
      log:flush()
      manager.machine:exit()
      return
    end
    queue_sound(id)
  elseif t == CYCLE - 1 then
    if ymcount > 40 then
      results[#results + 1] = { id = id, n = ymcount }
      log:write(string.format("id %3d -> %d FM writes", id, ymcount) .. NL)
      log:flush()
    end
    id = id + 1
  end
end)
