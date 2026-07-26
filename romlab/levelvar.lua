-- Find the level counter: watch work-RAM writes across the start of a new
-- game and keep addresses that get set to a small number (a level index is
-- initialised to 1) and are written rarely.
local OUT = "D:/repos/crenellation/romlab/out/lvl/"
local log = io.open(OUT .. "lvl.log", "w")
local frame = 0
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local RAM_LO, RAM_HI = 0x3E0000, 0x3E3FFF

local TAPS = {}
local recording = false
local seen = {}   -- addr -> {n=writes, v=last value, f=first frame}

local function fld(p,n) local port=manager.machine.ioport.ports[p]; return port and port.fields[n] or nil end
local coin, fire, fire2
local function set(f,v) if f then pcall(function() f:set_value(v) end) end end

local function install()
  TAPS[#TAPS+1] = space:install_write_tap(RAM_LO, RAM_HI, "ram", function(offset, data, mask)
    if recording then
      local v = data & 0xFF
      if v <= 8 then
        local e = seen[offset]
        if e then e.n = e.n + 1; e.v = v
        else seen[offset] = {n=1, v=v, f=frame} end
      end
    end
    return data
  end)
  log:write("tap installed frame " .. frame .. "\n"); log:flush()
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then
    install()
    coin=fld(":IN1","Coin 1"); fire=fld(":IN1","P1 Button 1"); fire2=fld(":IN0","P2 Button 1")
  end

  -- Coin up once, then mash to start a fresh game.
  if frame == 700 then set(coin,1) end
  if frame == 720 then set(coin,0) end
  if frame > 750 and frame < 2000 then
    local q = frame % 30
    if q == 0 then set(fire,1); set(fire2,1) end
    if q == 8 then set(fire,0); set(fire2,0) end
  end

  -- Record only across the window where the game boots into level 1.
  if frame == 760 then recording = true; log:write("recording ON\n"); log:flush() end
  if frame == 1600 then
    recording = false
    local list = {}
    for a,e in pairs(seen) do
      if e.v >= 1 and e.v <= 6 and e.n <= 12 then list[#list+1] = {a=a, e=e} end
    end
    table.sort(list, function(x,y) return x.e.n < y.e.n end)
    log:write(string.format("candidates (value 1-6, <=12 writes): %d\n", #list))
    for i=1,math.min(#list,120) do
      local r=list[i]
      log:write(string.format("  %06X v=%d writes=%d firstframe=%d\n", r.a, r.e.v, r.e.n, r.e.f))
    end
    log:flush()
    manager.machine:exit()
  end
end)
