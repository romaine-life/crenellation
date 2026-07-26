-- Causal test: overwrite a horizontal strip of the suspected map record in the
-- ROM image, then capture the playfield. If terrain changes in a matching
-- band, that region IS the map layout.
local OUT = "D:/repos/crenellation/romlab/out/patch/"
local log = io.open(OUT .. "patch.log", "w")
local frame = 0
local dumps = 0

local PATCH_LO, PATCH_HI = 0x3A480, 0x3A600
local PATCH_VAL = 0xFF

local function ports_field(p, n)
  local port = manager.machine.ioport.ports[p]
  return port and port.fields[n] or nil
end
local coin, fire, fire2
local function set(f, v) if f then pcall(function() f:set_value(v) end) end end

local function dump()
  local ok, err = pcall(function()
    local bmp = manager.machine.memory.shares[":bitmap"]
    local pal = manager.machine.memory.shares[":palette"]
    local t = {}
    for i = 0, bmp.size - 1 do t[#t + 1] = string.char(bmp:read_u8(i)) end
    local fh = io.open(string.format("%sbitmap-%02d.bin", OUT, dumps), "wb"); fh:write(table.concat(t)); fh:close()
    local pt = {}
    for i = 0, pal.size - 1 do pt[#pt + 1] = string.char(pal:read_u8(i)) end
    fh = io.open(string.format("%spalette-%02d.bin", OUT, dumps), "wb"); fh:write(table.concat(pt)); fh:close()
    dumps = dumps + 1
  end)
  if not ok then log:write("dump fail " .. tostring(err) .. "\n"); log:flush() end
end

emu.register_frame_done(function()
  frame = frame + 1

  if frame == 300 then
    coin = ports_field(":IN1", "Coin 1")
    fire = ports_field(":IN1", "P1 Button 1")
    fire2 = ports_field(":IN0", "P2 Button 1")
    local ok, err = pcall(function()
      local rgn = manager.machine.memory.regions[":maincpu"]
      local before = rgn:read_u8(PATCH_LO)
      for a = PATCH_LO, PATCH_HI - 1 do rgn:write_u8(a, PATCH_VAL) end
      log:write(string.format("patched %06X-%06X to %02X (was %02X at start)\n",
        PATCH_LO, PATCH_HI - 1, PATCH_VAL, before))
    end)
    log:write("patch ok=" .. tostring(ok) .. " " .. tostring(err) .. "\n"); log:flush()
  end

  if frame > 400 then
    local c = frame % 240
    if c == 0 then set(coin, 1) end
    if c == 20 then set(coin, 0) end
    local q = frame % 30
    if q == 0 then set(fire, 1); set(fire2, 1) end
    if q == 8 then set(fire, 0); set(fire2, 0) end
  end

  if frame > 3000 and frame % 600 == 0 and dumps < 8 then dump() end
  if dumps >= 8 or frame > 12000 then
    log:write("done, dumps=" .. dumps .. "\n"); log:flush()
    manager.machine:exit()
  end
end)
