-- Locate the music sequence data.
--
-- Record which PCs drive the YM2413 (the sound driver), and which ROM data
-- addresses those same code regions READ. The addresses the driver reads are
-- the note/sequence stream; the table that indexes them is what makes every
-- song reachable without playing the game.
local OUT = "D:/repos/crenellation/romlab/out/song/"
local log = io.open(OUT .. "driver.log", "w")
local NL = string.char(10)
local frame = 0

local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}

local ympcs = {}          -- PCs that write the FM chip
local reads = {}          -- bucket -> {n, pc}
local readpc = {}         -- pc -> count of ROM data reads

local function install()
  TAPS[#TAPS + 1] = space:install_write_tap(0x480000, 0x499fff, "ym", function(offset, data, mask)
    local pc = cpu.state["PC"].value
    ympcs[pc] = (ympcs[pc] or 0) + 1
    return data
  end)
  -- Data-region reads only; instruction fetches below 0x28000 would swamp this.
  TAPS[#TAPS + 1] = space:install_read_tap(0x028000, 0x0FFFFF, "rom", function(offset, data, mask)
    local pc = cpu.state["PC"].value
    readpc[pc] = (readpc[pc] or 0) + 1
    local b = offset - (offset % 0x100)
    local e = reads[b]
    if e then
      e.n = e.n + 1
    else
      reads[b] = { n = 1, pc = pc }
    end
    return data
  end)
  log:write("taps installed" .. NL)
  log:flush()
end

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
  if frame == 600 then install() end
  if frame > 650 then
    local c = frame % 240
    if c == 0 then set(":IN1", "Coin 1", 1) end
    if c == 20 then set(":IN1", "Coin 1", 0) end
    local q = frame % 30
    if q == 0 then set(":IN1", "P1 Button 1", 1); set(":IN0", "P2 Button 1", 1) end
    if q == 8 then set(":IN1", "P1 Button 1", 0); set(":IN0", "P2 Button 1", 0) end
  end

  if frame == 4500 then
    local l = {}
    for pc, n in pairs(ympcs) do l[#l + 1] = { pc = pc, n = n } end
    table.sort(l, function(a, b) return a.n > b.n end)
    log:write(NL .. "PCs writing the YM2413 (the sound driver):" .. NL)
    for i = 1, math.min(#l, 12) do
      log:write(string.format("   PC %06X  %d writes", l[i].pc, l[i].n) .. NL)
    end

    local r = {}
    for pc, n in pairs(readpc) do r[#r + 1] = { pc = pc, n = n } end
    table.sort(r, function(a, b) return a.n > b.n end)
    log:write(NL .. "PCs reading ROM data:" .. NL)
    for i = 1, math.min(#r, 15) do
      log:write(string.format("   PC %06X  %d reads", r[i].pc, r[i].n) .. NL)
    end

    local a = {}
    for b, e in pairs(reads) do a[#a + 1] = { b = b, n = e.n, pc = e.pc } end
    table.sort(a, function(x, y) return x.b < y.b end)
    -- Merge contiguous 256-byte buckets into runs.
    local runs = {}
    for _, e in ipairs(a) do
      local last = runs[#runs]
      if last and e.b == last.hi + 0x100 then
        last.hi = e.b; last.n = last.n + e.n
      else
        runs[#runs + 1] = { lo = e.b, hi = e.b, n = e.n, pc = e.pc }
      end
    end
    table.sort(runs, function(x, y) return (x.hi - x.lo) > (y.hi - y.lo) end)
    log:write(NL .. "contiguous ROM data regions read:" .. NL)
    for i = 1, math.min(#runs, 20) do
      local q = runs[i]
      log:write(string.format("   %06X-%06X  %7d reads  firstPC=%06X", q.lo, q.hi + 0xFF, q.n, q.pc) .. NL)
    end
    log:flush()
    manager.machine:exit()
  end
end)
