-- Harvest map variety: keep coining and mashing for a long run so games keep
-- starting and rounds keep advancing, dumping the playfield often. Dedupe
-- happens later in python against terrain signatures.
local OUT = "D:/repos/crenellation/romlab/out/caps3/"
local frame = 0
local dumps = 0
local MAX_DUMPS = 120

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
local p2b2 = f(":IN0", "P2 Button 2")

local log = io.open(OUT .. "capture.log", "w")

local function set(field, v)
  if field then pcall(function() field:set_value(v) end) end
end

local function dump()
  local ok, err = pcall(function()
    local bmp = manager.machine.memory.shares[":bitmap"]
    local pal = manager.machine.memory.shares[":palette"]
    local t = {}
    for i = 0, bmp.size - 1 do t[#t + 1] = string.char(bmp:read_u8(i)) end
    local fh = io.open(string.format("%sbitmap-%03d.bin", OUT, dumps), "wb")
    fh:write(table.concat(t)); fh:close()
    local pt = {}
    for i = 0, pal.size - 1 do pt[#pt + 1] = string.char(pal:read_u8(i)) end
    fh = io.open(string.format("%spalette-%03d.bin", OUT, dumps), "wb")
    fh:write(table.concat(pt)); fh:close()
    dumps = dumps + 1
    if dumps % 10 == 0 then log:write(string.format("frame %d: %d dumps\n", frame, dumps)); log:flush() end
  end)
  if not ok then log:write("dump failed: " .. tostring(err) .. "\n"); log:flush() end
end

emu.register_frame_done(function()
  frame = frame + 1

  -- Coin forever, so a fresh game starts whenever one ends.
  local c = frame % 240
  if c == 0 then set(coin, 1); set(coin2, 1) end
  if c == 20 then set(coin, 0); set(coin2, 0) end

  -- Both players mash: gets through menus, places castles, keeps rounds moving.
  local p = frame % 30
  if p == 0 then set(p1b1, 1); set(p1b2, 1); set(p2b1, 1); set(p2b2, 1) end
  if p == 8 then set(p1b1, 0); set(p1b2, 0); set(p2b1, 0); set(p2b2, 0) end

  if frame > 1200 and frame % 360 == 0 and dumps < MAX_DUMPS then dump() end
  if dumps >= MAX_DUMPS or frame > 60000 then
    log:write(string.format("done: %d dumps at frame %d\n", dumps, frame)); log:flush()
    manager.machine:exit()
  end
end)
