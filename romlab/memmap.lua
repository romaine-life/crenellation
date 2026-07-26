-- Probe the 68000 address map for regions that behave like RAM.
--
-- The port models ROM plus one work-RAM window, and every access outside that
-- is reported as hardware it cannot know. Some of those addresses are plain
-- memory on the board - the playfield bitmap, the palette, RAM mirrors - and
-- modelling them is just a matter of knowing where they are. Rather than
-- assume the map, write a value and read it back: whatever holds a value is
-- memory, whatever does not is a device.
local OUT = "D:/repos/crenellation/romlab/out/"
local log = io.open(OUT .. "memmap.txt", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local frame = 0

emu.register_frame_done(function()
  frame = frame + 1
  if frame ~= 400 then return end
  local runs = {}
  local cur = nil
  for base = 0, 0xFFFFFF, 0x1000 do
    local old = space:read_u16(base)
    space:write_u16(base, 0x5A5A)
    local a = space:read_u16(base)
    space:write_u16(base, 0xA5A5)
    local b = space:read_u16(base)
    space:write_u16(base, old)
    local isram = (a == 0x5A5A and b == 0xA5A5)
    if isram then
      if cur then cur.hi = base + 0x1000 else cur = { lo = base, hi = base + 0x1000 } end
    else
      if cur then runs[#runs + 1] = cur; cur = nil end
    end
  end
  if cur then runs[#runs + 1] = cur end
  for _, r in ipairs(runs) do
    log:write(string.format("RAM %06X-%06X  %d KiB", r.lo, r.hi - 1, (r.hi - r.lo) // 1024) .. NL)
  end
  -- and the ROM regions, so the port knows how much program it is missing
  for tag, region in pairs(manager.machine.memory.regions) do
    log:write(string.format("REGION %-12s %d bytes", tag, region.size) .. NL)
  end
  log:flush()
  manager.machine:exit()
end)
