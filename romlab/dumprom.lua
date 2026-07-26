-- Dump what the CPU actually sees at the ROM addresses, not what one ROM file
-- holds. The port was built from a 128 KiB overlay while the program region is
-- 1 MiB, so any read above 0x20000 compared against nothing.
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local frame = 0
emu.register_frame_done(function()
  frame = frame + 1
  if frame ~= 400 then return end
  local t = {}
  for a = 0, 0xFFFFF do t[#t + 1] = string.char(space:read_u8(a)) end
  local fh = io.open("D:/repos/crenellation/romlab/out/rom-full.bin", "wb")
  fh:write(table.concat(t)); fh:close()
  manager.machine:exit()
end)
