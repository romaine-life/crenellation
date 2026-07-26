-- Record exact per-frame motion-object RAM during play.
--
-- Cannonballs, cursors and explosions are motion objects, so their true
-- positions live in the :mob share. Dumping it every frame gives frame-exact
-- trajectories: flight time, arc shape, cursor speed -- the numbers the port
-- needs if it is to feel like the arcade rather than like a guess.
local OUT = "D:/repos/crenellation/romlab/out/traj/"
local log = io.open(OUT .. "traj.log", "w")
local NL = string.char(10)
local frame = 0
local dumped = 0
local fh = nil

local START = 3000        -- past boot; a coined game is running by then
local FRAMES = 1800       -- 30 seconds at frame accuracy

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

  -- Coin up and keep both players active so shots actually get fired.
  if frame > 600 then
    local c = frame % 240
    if c == 0 then set(":IN1", "Coin 1", 1) end
    if c == 20 then set(":IN1", "Coin 1", 0) end
    local q = frame % 20
    if q == 0 then set(":IN1", "P1 Button 1", 1); set(":IN0", "P2 Button 1", 1) end
    if q == 6 then set(":IN1", "P1 Button 1", 0); set(":IN0", "P2 Button 1", 0) end
  end

  if frame == START then
    fh = io.open(OUT .. "mob.bin", "wb")
    log:write("recording motion objects" .. NL)
    log:flush()
  end

  if fh and frame > START and dumped < FRAMES then
    local ok, err = pcall(function()
      local mob = manager.machine.memory.shares[":mob"]
      local t = {}
      for i = 0, mob.size - 1 do t[#t + 1] = string.char(mob:read_u8(i)) end
      fh:write(table.concat(t))
    end)
    if not ok then
      log:write("dump fail " .. tostring(err) .. NL)
      log:flush()
    end
    dumped = dumped + 1
  end

  if dumped >= FRAMES then
    if fh then fh:close(); fh = nil end
    log:write("frames recorded: " .. dumped .. NL)
    log:flush()
    manager.machine:exit()
  end
end)
