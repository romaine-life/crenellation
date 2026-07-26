-- Find the code that draws terrain, so the map table can be read directly
-- instead of playing to each level.
--
-- 1. Locate the bitmap in the 68000's address space by matching its contents
--    against the share we can already read.
-- 2. Install a write tap over that range and record which PCs write it, plus
--    the address registers at the time (the source pointer lives in one).
local OUT = "D:/repos/crenellation/romlab/out/"
local log = io.open(OUT .. "trace.log", "w")
local frame = 0
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local share = manager.machine.memory.shares[":bitmap"]

-- Signature must come from a varied window (a run of zeros matches ROM
-- padding anywhere), and RAM lives above the 1 MB program ROM.
local sig = {}
local function build_sig()
  local best, bestvar = 0, -1
  -- Step must match the scan step, or base+off never lands on a scanned address.
  for off = 0, share.size - 64, 0x1000 do
    local seen, n = {}, 0
    for i = 0, 63 do
      local v = share:read_u8(off + i)
      if not seen[v] then seen[v] = true; n = n + 1 end
    end
    if n > bestvar then bestvar, best = n, off end
  end
  for i = 0, 63 do sig[i] = share:read_u8(best + i) end
  log:write(string.format("signature from offset %X, %d distinct bytes\n", best, bestvar))
  return best, bestvar
end

local sig_off = 0
local base = nil
local function find_bitmap()
  for addr = 0x100000, 0xFFFFFF, 0x1000 do
    local ok = true
    for i = 0, 15 do
      local okr, v = pcall(function() return space:read_u8(addr + i) end)
      if not okr or v ~= sig[i] then ok = false break end
    end
    if ok then
      local hits = 0
      for i = 0, 63 do
        local okr, v = pcall(function() return space:read_u8(addr + i) end)
        if okr and v == sig[i] then hits = hits + 1 end
      end
      if hits >= 60 then
        -- addr is where the SIGNATURE sits; the share starts sig_off earlier.
        log:write(string.format("signature found at %08X -> bitmap base %08X\n", addr, addr - sig_off))
        return addr - sig_off
      end
    end
  end
  return nil
end

local pcs = {}
local taps = {}

emu.register_frame_done(function()
  frame = frame + 1

  -- Scan only once terrain is actually on screen (a blank bitmap has no
  -- signature worth matching).
  if frame == 2500 then
    local varied
    sig_off, varied = build_sig()
    base = find_bitmap()
    log:write("base=" .. tostring(base and string.format("%08X", base) or "NOT FOUND") .. "\n")
    log:flush()
    if base then
      local ok, err = pcall(function()
        taps[#taps + 1] = space:install_write_tap(base, base + share.size - 1, "bmp", function(offset, data, mask)
          local pc = cpu.state["PC"].value
          local e = pcs[pc]
          if e then
            e.n = e.n + 1
          else
            pcs[pc] = { n = 1,
                        a0 = cpu.state["A0"].value, a1 = cpu.state["A1"].value,
                        a2 = cpu.state["A2"].value, a3 = cpu.state["A3"].value }
          end
          return data
        end)
      end)
      log:write("tap installed: " .. tostring(ok) .. " " .. tostring(err) .. "\n")
      log:flush()
    end
  end

  -- Coin up and mash so a level actually loads while the tap is live.
  if frame > 300 then
    local c = frame % 240
    if c == 0 then
      local p = manager.machine.ioport.ports[":IN1"]
      if p then pcall(function() p.fields["Coin 1"]:set_value(1) end) end
    end
    if c == 20 then
      local p = manager.machine.ioport.ports[":IN1"]
      if p then pcall(function() p.fields["Coin 1"]:set_value(0) end) end
    end
    local q = frame % 30
    if q == 0 then
      local p = manager.machine.ioport.ports[":IN1"]
      if p then pcall(function() p.fields["P1 Button 1"]:set_value(1) end) end
    end
    if q == 8 then
      local p = manager.machine.ioport.ports[":IN1"]
      if p then pcall(function() p.fields["P1 Button 1"]:set_value(0) end) end
    end
  end

  if frame == 14000 then
    local list = {}
    for pc, e in pairs(pcs) do list[#list + 1] = { pc = pc, e = e } end
    table.sort(list, function(x, y) return x.e.n > y.e.n end)
    log:write(string.format("\n%d distinct writing PCs\n", #list))
    for i = 1, math.min(#list, 30) do
      local r = list[i]
      log:write(string.format("PC %08X  writes=%-8d A0=%08X A1=%08X A2=%08X A3=%08X\n",
        r.pc, r.e.n, r.e.a0, r.e.a1, r.e.a2, r.e.a3))
    end
    log:flush()
    manager.machine:exit()
  end
end)
