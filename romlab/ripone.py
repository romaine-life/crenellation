"""Generate ripone.lua: cold-boot, inject ONE sound id, log 75s of YM2413
writes. One MAME process per song keeps the driver state clean."""
import pathlib
import sys

SID = int(sys.argv[1])
SECONDS = int(sys.argv[2]) if len(sys.argv) > 2 else 75

TEMPLATE = """local OUT = "D:/repos/crenellation/romlab/out/song/rip/"
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local Q_LO, Q_HI, WPTR = 0x3E3D46, 0x3E3D55, 0x3E3D5A
local SID = __SID__
local RECORD = __FRAMES__
local frame, writes = 0, 0
local fh = nil

local function now()
  local t = manager.machine.time
  local ok, v = pcall(function() return t:as_double() end)
  if ok then return v end
  return t.seconds
end

local function install()
  TAPS[#TAPS + 1] = space:install_write_tap(0x480000, 0x499fff, "ym", function(offset, data, mask)
    if fh then
      fh:write(string.format("%.6f %d %02X", now(), offset & 3, (data >> 8) & 0xFF) .. NL)
      writes = writes + 1
    end
    return data
  end)
  TAPS[#TAPS + 1] = space:install_write_tap(0x460000, 0x479fff, "oki", function(offset, data, mask)
    return 0
  end)
end

local function queue_sound(sid)
  pcall(function()
    local p = space:read_u32(WPTR)
    p = p + 1
    if p > Q_HI or p < Q_LO then p = Q_LO end
    space:write_u32(WPTR, p)
    space:write_u8(p, sid)
  end)
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install() end
  if frame == 3000 then
    fh = io.open(string.format("%ssong-%03d.log", OUT, SID), "w")
    queue_sound(SID)
  end
  if frame == 3000 + RECORD then
    if fh then fh:close(); fh = nil end
    local s = io.open(OUT .. string.format("count-%03d.txt", SID), "w")
    s:write(tostring(writes)); s:close()
    manager.machine:exit()
  end
end)
"""

lua = TEMPLATE.replace("__SID__", str(SID)).replace("__FRAMES__", str(SECONDS * 60))
pathlib.Path(pathlib.Path(__file__).parent / "ripone.lua").write_text(lua)
print(f"id {SID}, {SECONDS}s")
