-- Build a "who writes what" index for the whole of work RAM.
--
-- Locating a system by guessing at call sites does not scale. Every game system
-- keeps its state in work RAM, so an index of address -> writing routine turns
-- "find the routine that does X" into "find the address that holds X".
--
-- Write taps are cheap compared with instruction tracing: writes to work RAM
-- are thousands of times rarer than instruction fetches. CURPC (not PC, which
-- points at the NEXT instruction) names the writing instruction.
local OUT = "D:/repos/crenellation/romlab/out/whowrites/"
local log = io.open(OUT .. "w.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local frame = 0
local writers = {}        -- addr -> { pc -> count }
local tracing = false
local tx, ty = 0, 0

local function fld(p, n) local port = manager.machine.ioport.ports[p]; return port and port.fields[n] or nil end
local function set(p, n, v) local f = fld(p, n); if f then pcall(function() f:set_value(v) end) end end

local function install()
  TAPS[#TAPS + 1] = space:install_write_tap(0x3E0000, 0x3EFFFF, "w", function(offset, data, mask)
    local pc = cpu.state["CURPC"].value
    local e = writers[offset]
    if e then e[pc] = (e[pc] or 0) + 1
    else writers[offset] = { [pc] = 1 } end
    return data
  end)
  tracing = true
end

local function dump_ram(tag)
  local t = {}
  for a = 0x3E0000, 0x3EFFFF, 2 do
    local v = space:read_u16(a)
    t[#t + 1] = string.char(math.floor(v / 256) % 256, v % 256)
  end
  local fh = io.open(OUT .. "ram-" .. tag .. ".bin", "wb")
  fh:write(table.concat(t)); fh:close()
end

emu.register_frame_done(function()
  frame = frame + 1
  -- coin up and start
  if frame > 600 and frame < 3000 then
    local c = frame % 240
    if c == 0 then set(":IN1", "Coin 1", 1) end
    if c == 20 then set(":IN1", "Coin 1", 0) end
    if c == 40 then set(":IN1", "P1 Button 1", 1) end
    if c == 50 then set(":IN1", "P1 Button 1", 0) end
  end
  -- play: keep the cursor moving and drop pieces
  if frame > 900 then
    tx = (tx + 7) % 256; ty = (ty + 11) % 256
    set(":TRACK3", "Trackball X", tx)
    set(":TRACK2", "Trackball Y", ty)
    local q = frame % 45
    if q == 0 then set(":IN1", "P1 Button 1", 1) end
    if q == 6 then set(":IN1", "P1 Button 1", 0) end
  end

  if frame == 3000 then dump_ram("a"); install(); log:write("tracing on" .. NL); log:flush() end
  if frame == 3240 then dump_ram("b") end
  if frame == 3600 then
    dump_ram("c")
    local n = 0
    for addr, pcs in pairs(writers) do
      local parts = {}
      for pc, cnt in pairs(pcs) do parts[#parts + 1] = string.format("%06X:%d", pc, cnt) end
      log:write(string.format("%06X %s", addr, table.concat(parts, ","))) log:write(NL)
      n = n + 1
    end
    log:write("addresses " .. n .. NL)
    log:flush()
    manager.machine:exit()
  end
end)
