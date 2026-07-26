-- Rip each candidate song cleanly.
--
-- Per song: inject id 0 (stop) so the chip goes quiet, wait, inject the target
-- id, then log 60s of YM2413 writes to its own file. Sample-chip writes are
-- swallowed and never logged, so nothing but music is captured.
local OUT = "D:/repos/crenellation/romlab/out/song/rip/"
local status = io.open(OUT .. "rip.log", "w")
local NL = string.char(10)

local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}

local Q_LO, Q_HI = 0x3E3D46, 0x3E3D55
local WPTR = 0x3E3D5A

local IDS = { 14, 13, 21, 252, 22, 18, 3, 4, 116, 12, 17, 117, 118, 119, 120, 251 }
local SETTLE = 180        -- 3s of silence after the stop command
local RECORD = 3600       -- 60s of music
local CYCLE = SETTLE + RECORD + 120
local START = 3000

local frame, idx = 0, 1
local fh = nil
local writes = 0

local function now()
  local t = manager.machine.time
  local ok, v = pcall(function() return t:as_double() end)
  if ok then return v end
  return t.seconds
end

local function install()
  TAPS[#TAPS + 1] = space:install_write_tap(0x480000, 0x499fff, "ym", function(offset, data, mask)
    if fh then
      fh:write(string.format("%.6f %d %02X", now(), offset & 3, (data >> 8) & 0xFF) .. NL)
      writes = writes + 1
    end
    return data
  end)
  TAPS[#TAPS + 1] = space:install_write_tap(0x460000, 0x479fff, "oki", function(offset, data, mask)
    return 0
  end)
  status:write("taps installed" .. NL)
  status:flush()
end

local function queue_sound(sid)
  pcall(function()
    local p = space:read_u32(WPTR)
    p = p + 1
    if p > Q_HI or p < Q_LO then p = Q_LO end
    space:write_u32(WPTR, p)
    space:write_u8(p, sid)
  end)
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install() end
  if frame < START then return end

  local t = (frame - START) % CYCLE
  if t == 0 then
    if idx > #IDS then
      status:write("done" .. NL)
      status:flush()
      manager.machine:exit()
      return
    end
    queue_sound(0)          -- stop whatever is playing
  elseif t == SETTLE then
    writes = 0
    fh = io.open(string.format("%ssong-%03d.log", OUT, IDS[idx]), "w")
    queue_sound(IDS[idx])
  elseif t == SETTLE + RECORD then
    if fh then fh:close(); fh = nil end
    status:write(string.format("id %d -> %d writes", IDS[idx], writes) .. NL)
    status:flush()
    idx = idx + 1
  end
end)
