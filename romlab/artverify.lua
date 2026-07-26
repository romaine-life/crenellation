-- Byte-exact verification of the art decoder against real in-game draws.
--
-- Tap the decompressor's call site to capture (source, destination, palette,
-- row counter), then read the destination back once the call has completed and
-- log the actual 8x8 pixels the hardware produced. Comparing that against the
-- port's output for every call verifies the decoded art itself, not just the
-- decoder in isolation - thousands of tiles of real coverage.
--
-- The readback happens on the NEXT tap, by which point the previous call has
-- returned. The final pending call is flushed at the end.
local OUT = "D:/repos/crenellation/romlab/out/artverify/"
local log = io.open(OUT .. "tiles.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local frame = 0
local recording = false
local pend = nil
local n = 0
local tx, ty = 0, 0

local DECOMP = 0x11F1C
local STRIDE = 512

local function fld(p, f) local port = manager.machine.ioport.ports[p]; return port and port.fields[f] or nil end
local function set(p, f, v) local q = fld(p, f); if q then pcall(function() q:set_value(v) end) end end

local function flush()
  if not pend then return end
  local parts = {}
  for row = 0, 7 do
    for col = 0, 7 do
      parts[#parts + 1] = string.format("%02X", space:read_u8(pend.dst + row * STRIDE + col))
    end
  end
  log:write(string.format("C %06X %06X %d %d %s", pend.src, pend.dst, pend.pal, pend.d4,
                          table.concat(parts)) .. NL)
  n = n + 1
  pend = nil
end

local function install()
  TAPS[#TAPS + 1] = space:install_read_tap(DECOMP, DECOMP + 1, "e", function(offset, data, mask)
    if recording then
      flush()
      pend = { src = cpu.state["A0"].value, dst = cpu.state["A1"].value,
               pal = cpu.state["D2"].value & 0xFFFF, d4 = cpu.state["D4"].value & 0xFFFF }
    end
    return data
  end)
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 400 then install() end
  if frame == 500 then recording = true end
  -- drive the game so gameplay art (terrain) is drawn too, not just attract
  if frame > 900 and frame < 4000 then
    local c = frame % 240
    if c == 0 then set(":IN1", "Coin 1", 1) end
    if c == 20 then set(":IN1", "Coin 1", 0) end
    if c == 40 then set(":IN1", "P1 Button 1", 1) end
    if c == 50 then set(":IN1", "P1 Button 1", 0) end
  end
  if frame > 1200 then
    tx = (tx + 7) % 256; ty = (ty + 11) % 256
    set(":TRACK3", "Trackball X", tx); set(":TRACK2", "Trackball Y", ty)
    local q = frame % 45
    if q == 0 then set(":IN1", "P1 Button 1", 1) end
    if q == 6 then set(":IN1", "P1 Button 1", 0) end
  end
  if frame == 9000 then
    recording = false; flush()
    -- palette, so the port can colour what it decodes
    local pal = manager.machine.memory.shares[":palette"]
    local pt = {}
    for i = 0, pal.size - 1 do pt[#pt + 1] = string.char(pal:read_u8(i)) end
    local fh = io.open(OUT .. "palette.bin", "wb"); fh:write(table.concat(pt)); fh:close()
    log:write("tiles " .. n .. NL); log:flush()
    manager.machine:exit()
  end
end)
