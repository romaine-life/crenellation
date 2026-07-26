"""Generate poke.lua: force a subset of candidate level-counter addresses to a
given level number, then capture the playfield. Used to bisect which address
actually selects the map."""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
log = (HERE / "out" / "lvl" / "lvl.log").read_text()
addrs = [int(m.group(1), 16) for m in re.finditer(r"^\s+([0-9A-F]{6}) v=", log, re.M)]

lo, hi, val = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
sub = addrs[lo:hi]

TEMPLATE = """-- Hold candidate level-counter addresses at a new level, then capture.
local OUT = "D:/repos/crenellation/romlab/out/poke/"
local log = io.open(OUT .. "poke.log", "w")
local frame, dumps = 0, 0
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local ADDRS = __ADDRLIST__
local VAL = __VAL__
local NL = string.char(10)

local function fld(p, n)
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
    local fh = io.open(string.format("%sbitmap-%02d.bin", OUT, dumps), "wb")
    fh:write(table.concat(t)); fh:close()
    local pt = {}
    for i = 0, pal.size - 1 do pt[#pt + 1] = string.char(pal:read_u8(i)) end
    fh = io.open(string.format("%spalette-%02d.bin", OUT, dumps), "wb")
    fh:write(table.concat(pt)); fh:close()
    dumps = dumps + 1
  end)
  if not ok then log:write("dump fail " .. tostring(err) .. NL); log:flush() end
end

log:write("poking " .. #ADDRS .. " addrs to " .. VAL .. NL)
log:flush()

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then
    coin = fld(":IN1", "Coin 1"); fire = fld(":IN1", "P1 Button 1"); fire2 = fld(":IN0", "P2 Button 1")
  end
  if frame == 700 then set(coin, 1) end
  if frame == 720 then set(coin, 0) end
  if frame > 750 and frame < 3000 then
    local q = frame % 30
    if q == 0 then set(fire, 1); set(fire2, 1) end
    if q == 8 then set(fire, 0); set(fire2, 0) end
  end
  -- Single-shot pokes during the game-start sequence (the candidates are first
  -- written between frames ~760-1600). Holding them every frame clobbers live
  -- state and black-screens the machine, so write once at a few moments and
  -- let the game run.
  if frame == 800 or frame == 900 or frame == 1000 or frame == 1100 then
    for i = 1, #ADDRS do pcall(function() space:write_u8(ADDRS[i], VAL) end) end
    log:write("poked at frame " .. frame .. NL); log:flush()
  end
  -- Many captures across the round so a frame without score/UI panels over
  -- the terrain can be chosen later.
  if frame > 1700 and frame % 220 == 0 and dumps < 14 then dump() end
  if dumps >= 14 or frame > 8000 then
    log:write("done dumps=" .. dumps .. " frame=" .. frame .. NL); log:flush()
    manager.machine:exit()
  end
end)
"""

lua = TEMPLATE.replace("__ADDRLIST__", "{" + ",".join(str(a) for a in sub) + "}").replace("__VAL__", str(val))
(HERE / "poke.lua").write_text(lua)
print(f"poking {len(sub)} addrs [{lo}:{hi}] to {val}")
