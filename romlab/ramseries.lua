-- Sample work RAM over a long gameplay session.
--
-- Game state cannot be found by guessing at call sites. It can be found by
-- behaviour: a score only ever increases, a phase variable cycles through a
-- small set of values on a long period, a countdown falls steadily. Sampling
-- the whole of work RAM over time makes those signatures searchable.
local OUT = "D:/repos/crenellation/romlab/out/series/"
local log = io.open(OUT .. "s.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local frame, n = 0, 0
local tx, ty = 0, 0
local STEP, FROM, TO = 15, 900, 9900

local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end

local acc = {}
emu.register_frame_done(function()
  frame = frame + 1
  if frame > 600 and frame < 9000 then
    local c = frame % 240
    if c == 0 then set(":IN1","Coin 1",1) end
    if c == 20 then set(":IN1","Coin 1",0) end
    if c == 40 then set(":IN1","P1 Button 1",1) end
    if c == 50 then set(":IN1","P1 Button 1",0) end
  end
  if frame > 900 then
    tx=(tx+7)%256; ty=(ty+11)%256
    set(":TRACK3","Trackball X",tx); set(":TRACK2","Trackball Y",ty)
    local q = frame % 45
    if q == 0 then set(":IN1","P1 Button 1",1) end
    if q == 6 then set(":IN1","P1 Button 1",0) end
  end
  if frame >= FROM and frame <= TO and (frame - FROM) % STEP == 0 then
    local t = {}
    for a = 0x3E0000, 0x3EFFFF, 2 do
      local v = space:read_u16(a)
      t[#t+1] = string.char(math.floor(v/256)%256, v%256)
    end
    acc[#acc+1] = table.concat(t)
    n = n + 1
    if #acc >= 40 then
      local fh = io.open(OUT.."ram.bin","ab"); fh:write(table.concat(acc)); fh:close()
      acc = {}
    end
  end
  if frame == TO + 30 then
    if #acc > 0 then
      local fh = io.open(OUT.."ram.bin","ab"); fh:write(table.concat(acc)); fh:close()
    end
    log:write(string.format("samples %d step %d from %d", n, STEP, FROM)..NL)
    log:flush(); manager.machine:exit()
  end
end)
