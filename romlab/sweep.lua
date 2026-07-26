-- Sweep candidate level-counter addresses, one machine-reset per candidate.
local OUT = "D:/repos/crenellation/romlab/out/sweep/"
local log = io.open(OUT .. "sweep.log", "w")
local NL = string.char(10)
local ADDRS = {4077730}
local VAL = 4
local CYCLE = 5600

local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local frame, idx = 0, 1

local function fld(p, n)
  local port = manager.machine.ioport.ports[p]
  return port and port.fields[n] or nil
end
local function set(p, n, v)
  local f = fld(p, n)
  if f then pcall(function() f:set_value(v) end) end
end

local function capture(i)
  local ok, err = pcall(function()
    local bmp = manager.machine.memory.shares[":bitmap"]
    local pal = manager.machine.memory.shares[":palette"]
    local t = {}
    for k = 0, bmp.size - 1 do t[#t + 1] = string.char(bmp:read_u8(k)) end
    local fh = io.open(string.format("%sbitmap-%03d.bin", OUT, i), "wb")
    fh:write(table.concat(t)); fh:close()
    local pt = {}
    for k = 0, pal.size - 1 do pt[#pt + 1] = string.char(pal:read_u8(k)) end
    fh = io.open(string.format("%spalette-%03d.bin", OUT, i), "wb")
    fh:write(table.concat(pt)); fh:close()
  end)
  if not ok then log:write("capture fail " .. tostring(err) .. NL); log:flush() end
end

log:write("sweeping " .. #ADDRS .. " candidates, cycle " .. CYCLE .. NL)
log:flush()

emu.register_frame_done(function()
  frame = frame + 1
  if idx > #ADDRS then manager.machine:exit() return end

  local t = frame % CYCLE

  if t == 1 then
    manager.machine:soft_reset()
  elseif t == 900 then
    set(":IN1", "Coin 1", 1)
  elseif t == 920 then
    set(":IN1", "Coin 1", 0)
  elseif t > 950 and t < 3000 then
    local q = t % 30
    if q == 0 then set(":IN1", "P1 Button 1", 1); set(":IN0", "P2 Button 1", 1) end
    if q == 8 then set(":IN1", "P1 Button 1", 0); set(":IN0", "P2 Button 1", 0) end
  end

  -- Poke this candidate across the level-start window.
  if t == 1000 or t == 1100 or t == 1200 or t == 1400 then
    pcall(function() space:write_u8(ADDRS[idx], VAL) end)
  end

  if t == 2000 or t == 2600 or t == 3200 or t == 3800 or t == 4400 or t == 5000 then
    capture(idx * 100 + math.floor(t / 100))
  end
  if t == 5200 then
    capture(idx)
    log:write(string.format("candidate %d addr %06X captured at frame %d", idx, ADDRS[idx], frame) .. NL)
    log:flush()
    idx = idx + 1
  end
end)
