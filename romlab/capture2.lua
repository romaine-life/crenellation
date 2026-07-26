-- Get past attract mode: coin repeatedly (the first attempts land during the
-- boot self-test and are ignored), tap start/fire continuously, and dump the
-- playfield periodically for a long run.
local OUT = "D:/repos/crenellation/romlab/out/caps2/"
local frame = 0
local dumps = 0

local ports = manager.machine.ioport.ports
local function f(port, name)
  local p = ports[port]
  return p and p.fields[name] or nil
end

local coin = f(":IN1", "Coin 1")
local coin2 = f(":IN1", "Coin 2")
local p1b1 = f(":IN1", "P1 Button 1")
local p1b2 = f(":IN1", "P1 Button 2")
local p2b1 = f(":IN0", "P2 Button 1")

local log = io.open(OUT .. "capture.log", "w")

local function set(field, v)
  if field then pcall(function() field:set_value(v) end) end
end

local function dump(tag)
  local ok, err = pcall(function()
    local bmp = manager.machine.memory.shares[":bitmap"]
    local pal = manager.machine.memory.shares[":palette"]
    local t = {}
    for i = 0, bmp.size - 1 do t[#t + 1] = string.char(bmp:read_u8(i)) end
    local fh = io.open(string.format("%sbitmap-%02d.bin", OUT, dumps), "wb")
    fh:write(table.concat(t)); fh:close()
    local pt = {}
    for i = 0, pal.size - 1 do pt[#pt + 1] = string.char(pal:read_u8(i)) end
    fh = io.open(string.format("%spalette-%02d.bin", OUT, dumps), "wb")
    fh:write(table.concat(pt)); fh:close()
    log:write(string.format("frame %d: dump %02d (%s)\n", frame, dumps, tag)); log:flush()
    dumps = dumps + 1
  end)
  if not ok then log:write("dump failed: " .. tostring(err) .. "\n"); log:flush() end
end

emu.register_frame_done(function()
  frame = frame + 1

  -- Coin every 3 seconds from 5s in (well clear of the self-test), 6 coins.
  if frame > 300 and frame < 1400 then
    local p = frame % 180
    if p == 0 then set(coin, 1); set(coin2, 1) end
    if p == 20 then set(coin, 0); set(coin2, 0) end
  end

  -- Start/fire taps, continuously, on both players.
  if frame > 400 then
    local p = frame % 40
    if p == 0 then set(p1b1, 1); set(p1b2, 1); set(p2b1, 1) end
    if p == 10 then set(p1b1, 0); set(p1b2, 0); set(p2b1, 0) end
  end

  -- Dump every 5s once we should be past the intro, 40 dumps max.
  if frame > 1500 and frame % 300 == 0 and dumps < 40 then dump("periodic") end
  if frame > 15000 then manager.machine:exit() end
end)
