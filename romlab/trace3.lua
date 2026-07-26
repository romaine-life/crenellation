-- Isolate the map layout: record ROM data reads PER FRAME, and keep only the
-- frames with a big bitmap-write burst (a level being drawn). The layout is
-- read about once per cell during that burst; lookup tables are read far more.
local OUT = "D:/repos/crenellation/romlab/out/"
local log = io.open(OUT .. "trace3.log", "w")
local frame = 0
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]

local BITMAP, BMP_SIZE = 0x200000, 0x20000
local LO, HI = 0x028000, 0x053000

local TAPS = {}
local writes = 0
local cur = {}
local best = {}   -- list of {frame, writes, reads}

local function install()
  TAPS[#TAPS + 1] = space:install_write_tap(BITMAP, BITMAP + BMP_SIZE - 1, "w", function(o, d, m)
    writes = writes + 1
    return d
  end)
  TAPS[#TAPS + 1] = space:install_read_tap(LO, HI - 1, "r", function(o, d, m)
    local b = o - (o % 0x40)
    cur[b] = (cur[b] or 0) + 1
    return d
  end)
  log:write("taps installed frame " .. frame .. "\n"); log:flush()
end

local function ports_field(p, n)
  local port = manager.machine.ioport.ports[p]
  return port and port.fields[n] or nil
end
local coin, fire, fire2
local function set(f, v) if f then pcall(function() f:set_value(v) end) end end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then
    install()
    coin = ports_field(":IN1", "Coin 1")
    fire = ports_field(":IN1", "P1 Button 1")
    fire2 = ports_field(":IN0", "P2 Button 1")
  end

  if writes > 3000 then
    best[#best + 1] = { frame = frame, writes = writes, reads = cur }
    if #best > 6 then
      table.sort(best, function(a, b) return a.writes > b.writes end)
      best[#best] = nil
    end
  end
  writes = 0
  cur = {}

  if frame > 700 then
    local c = frame % 240
    if c == 0 then set(coin, 1) end
    if c == 20 then set(coin, 0) end
    local q = frame % 30
    if q == 0 then set(fire, 1); set(fire2, 1) end
    if q == 8 then set(fire, 0); set(fire2, 0) end
  end

  if frame == 9000 then
    table.sort(best, function(a, b) return a.writes > b.writes end)
    log:write(string.format("kept %d burst frames\n", #best))
    for i = 1, math.min(#best, 4) do
      local e = best[i]
      log:write(string.format("\n=== burst frame %d, %d bitmap writes ===\n", e.frame, e.writes))
      local list = {}
      for b, n in pairs(e.reads) do list[#list + 1] = { b = b, n = n } end
      table.sort(list, function(x, y) return x.b < y.b end)
      -- contiguous runs
      local runs = {}
      for _, r in ipairs(list) do
        local last = runs[#runs]
        if last and r.b == last.hi + 0x40 then
          last.hi = r.b; last.n = last.n + r.n; last.k = last.k + 1
        else
          runs[#runs + 1] = { lo = r.b, hi = r.b, n = r.n, k = 1 }
        end
      end
      table.sort(runs, function(x, y) return x.n > y.n end)
      for j = 1, math.min(#runs, 10) do
        local r = runs[j]
        log:write(string.format("   %06X-%06X  %4d buckets  %7d reads  (%.1f per byte)\n",
          r.lo, r.hi + 0x3F, r.k, r.n, r.n / (r.k * 64)))
      end
    end
    log:flush()
    manager.machine:exit()
  end
end)
