-- Find the map layout table: watch ROM reads in the low-entropy table area
-- while a level loads, and correlate them with the burst of bitmap writes.
local OUT = "D:/repos/crenellation/romlab/out/"
local log = io.open(OUT .. "trace2.log", "w")
local frame = 0
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]

local BITMAP = 0x200000
local BMP_SIZE = 0x20000
local TBL_LO, TBL_HI = 0x028000, 0x053000

local writes_this_frame = 0
local reads = {}          -- bucket -> count  (bucket = addr & ~0x3F)
local read_frames = {}    -- bucket -> first frame seen
local busiest = { frame = 0, writes = 0 }
local draw_frames = {}

-- Taps must be (a) kept alive against GC and (b) installed AFTER the boot
-- self-test settles — installing at script load loses them to the reset.
local TAPS = {}

local function install_taps()
  TAPS[#TAPS + 1] = space:install_write_tap(BITMAP, BITMAP + BMP_SIZE - 1, "bmpw", function(offset, data, mask)
    writes_this_frame = writes_this_frame + 1
    return data
  end)
  TAPS[#TAPS + 1] = space:install_read_tap(TBL_LO, TBL_HI - 1, "tblr", function(offset, data, mask)
    local b = offset - (offset % 0x40)
    reads[b] = (reads[b] or 0) + 1
    if not read_frames[b] then read_frames[b] = frame end
    return data
  end)
  log:write(string.format("taps installed at frame %d (%d)\n", frame, #TAPS))
  log:flush()
end

local function ports_field(port, name)
  local p = manager.machine.ioport.ports[port]
  return p and p.fields[name] or nil
end
local coin = ports_field(":IN1", "Coin 1")
local fire = ports_field(":IN1", "P1 Button 1")
local fire2 = ports_field(":IN0", "P2 Button 1")
local function set(f, v) if f then pcall(function() f:set_value(v) end) end end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install_taps() end

  -- A level draw is a huge write burst; note the frames where that happens.
  if writes_this_frame > 20000 then
    draw_frames[#draw_frames + 1] = { frame = frame, writes = writes_this_frame }
    if writes_this_frame > busiest.writes then busiest = { frame = frame, writes = writes_this_frame } end
  end
  writes_this_frame = 0

  if frame > 300 then
    local c = frame % 240
    if c == 0 then set(coin, 1) end
    if c == 20 then set(coin, 0) end
    local q = frame % 30
    if q == 0 then set(fire, 1); set(fire2, 1) end
    if q == 8 then set(fire, 0); set(fire2, 0) end
  end

  if frame == 9000 then
    log:write(string.format("bitmap draw bursts: %d (busiest frame %d, %d writes)\n",
      #draw_frames, busiest.frame, busiest.writes))
    for i = 1, math.min(#draw_frames, 12) do
      log:write(string.format("  burst frame %d writes=%d\n", draw_frames[i].frame, draw_frames[i].writes))
    end

    local list = {}
    for b, n in pairs(reads) do list[#list + 1] = { b = b, n = n, f = read_frames[b] } end
    table.sort(list, function(x, y) return x.b < y.b end)
    log:write(string.format("\n%d distinct 64-byte buckets read in %06X-%06X\n", #list, TBL_LO, TBL_HI))

    -- Contiguous runs of read buckets are what a table looks like.
    local runs = {}
    for _, r in ipairs(list) do
      local last = runs[#runs]
      if last and r.b == last.hi + 0x40 then
        last.hi = r.b; last.n = last.n + r.n; last.buckets = last.buckets + 1
      else
        runs[#runs + 1] = { lo = r.b, hi = r.b, n = r.n, buckets = 1, f = r.f }
      end
    end
    table.sort(runs, function(x, y) return (x.hi - x.lo) > (y.hi - y.lo) end)
    log:write("\nlargest contiguous read runs:\n")
    for i = 1, math.min(#runs, 20) do
      local r = runs[i]
      log:write(string.format("  %06X-%06X  %5d buckets  %8d reads  first seen frame %d\n",
        r.lo, r.hi + 0x3F, r.buckets, r.n, r.f))
    end
    log:flush()
    manager.machine:exit()
  end
end)
