-- Record every call to the graphics decompressor, then dump the framebuffer.
--
-- An instruction fetch goes through the program space, so a read tap on the
-- routine's first instruction fires on entry. At that moment a0/a1/d2 hold the
-- source, destination and palette base. Replaying that call list through the
-- verified port must reproduce the framebuffer exactly.
local OUT = "D:/repos/crenellation/romlab/out/art/"
local log = io.open(OUT .. "calls.log", "w")
local NL = string.char(10)

local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local frame = 0
local recording = false
local calls = 0

-- Where the routine starts, and where the bitmap lives in CPU space.
-- 0x11F2A is the LOOP HEAD (the routine branches back to it), so tapping it
-- captures mid-run states, not calls. 0x11F1C is the bsr that enters it, by
-- which point a0/a1/d2/d4 are all set up.
local DECOMP = 0x11F1C
local BITMAP = 0x200000
local BMP_SIZE = 0x20000

local function install()
  TAPS[#TAPS + 1] = space:install_read_tap(DECOMP, DECOMP + 1, "entry", function(offset, data, mask)
    if recording then
      calls = calls + 1
      log:write(string.format(
        "C %d %06X %06X %d %d",
        frame,
        cpu.state["A0"].value,
        cpu.state["A1"].value,
        cpu.state["D2"].value & 0xFFFF,
        cpu.state["D4"].value & 0xFFFF
      ) .. NL)
    end
    return data
  end)
end

local function dump_bitmap(tag)
  local bmp = manager.machine.memory.shares[":bitmap"]
  local t = {}
  for i = 0, bmp.size - 1 do t[#t + 1] = string.char(bmp:read_u8(i)) end
  local fh = io.open(OUT .. tag .. "-bitmap.bin", "wb")
  fh:write(table.concat(t))
  fh:close()
  local pal = manager.machine.memory.shares[":palette"]
  local pt = {}
  for i = 0, pal.size - 1 do pt[#pt + 1] = string.char(pal:read_u8(i)) end
  fh = io.open(OUT .. tag .. "-palette.bin", "wb")
  fh:write(table.concat(pt))
  fh:close()
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 400 then
    install()
    log:write("tap installed" .. NL)
    log:flush()
  end

  -- Clear the bitmap, then record every drawing call that rebuilds it. The
  -- attract title redraws itself on a cycle, so a window that spans one redraw
  -- captures a complete screen.
  if frame == 600 then
    -- snapshot the framebuffer BEFORE any recorded call, so the replay has a
    -- known starting state to build on
    dump_bitmap("before")
    recording = true
    log:write("S " .. frame .. NL)
    log:flush()
  end
  if frame == 1500 then
    recording = false
    dump_bitmap("after")
    log:write(string.format("E %d calls=%d", frame, calls) .. NL)
    log:flush()
    manager.machine:exit()
  end
end)
