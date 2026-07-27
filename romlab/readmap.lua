-- Which addresses return something when read.
--
-- The earlier probe looked for RAM: write a value, read it back. That finds
-- memory and misses every read-only decode - the watchdog, the EEPROM, the
-- input latches - and routines do read those. This one only reads, and records
-- where the answer is not the open-bus value the undecoded space gives back.
local f = io.open("D:/repos/crenellation/romlab/out/readmap.txt", "w")
local NL = string.char(10)
local frame = 0
emu.register_frame_done(function()
  frame = frame + 1
  if frame ~= 400 then return end
  local space = manager.machine.devices[":maincpu"].spaces["program"]
  local runs = {}
  local cur = nil
  for base = 0, 0xFFFFFF, 0x1000 do
    local a = space:read_u16(base)
    local b = space:read_u16(base + 0x800)
    -- undecoded space reads back the same filler everywhere; anything that
    -- varies within the block, or is not the filler, is decoding something
    local live = not (a == b and (a == 0xFFFF or a == 0x0000))
    if live then
      if cur then cur.hi = base + 0x1000 else cur = { lo = base, hi = base + 0x1000 } end
    else
      if cur then runs[#runs + 1] = cur; cur = nil end
    end
  end
  if cur then runs[#runs + 1] = cur end
  for _, r in ipairs(runs) do
    f:write(string.format("READ %06X-%06X  %d KiB", r.lo, r.hi - 1, (r.hi - r.lo) // 1024) .. NL)
  end
  f:flush()
  manager.machine:exit()
end)
