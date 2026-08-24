-- Snapshot the real machine at a known frame, with its display list beside it.
--
-- The port renders the playfield and nothing else; MAME renders the sprites
-- too. A frame from each at the same moment therefore differs by exactly the
-- sprite layer, and that difference is the only thing that can say what the
-- attribute bits in a display-list entry mean - the ROM cannot, because
-- nothing in it ever reads them back.
--
-- Writes a PNG through MAME's own snapshot path and a text dump of the list at
-- the same instant, so the two can be lined up afterwards.
local OUT = "D:/repos/crenellation/romlab/out/mo/"
local AT = tonumber(os.getenv("MOFRAME") or "600")
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local frame = 0
local done = false

local function dump()
  local f = io.open(OUT .. "list-" .. AT .. ".txt", "w")
  local NL = string.char(10)
  f:write("frame " .. AT .. NL)
  for s = 0, 0x46 do
    local a = 0x3E0000 + s * 8
    local link = space:read_u16(a)
    local code = space:read_u16(a + 2)
    local x    = space:read_u16(a + 4)
    local y    = space:read_u16(a + 6)
    if not (link == 0 and code == 0 and x == 0 and y == 0) then
      f:write(string.format("slot %02X link %04X code %04X x %04X y %04X", s, link, code, x, y) .. NL)
    end
  end
  f:close()
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == AT and not done then
    done = true
    dump()
    manager.machine.video:snapshot()
    manager.machine:exit()
  end
end)
