-- Work RAM as the chip has it at a known frame. Comparing sequences needs the
-- two sides aligned and the chip's trace cannot start at reset; comparing the
-- memory itself needs no alignment at all.
local cpu, space
local frame = 0
emu.register_frame_done(function()
  frame = frame + 1
  if cpu == nil then
    cpu = manager.machine.devices[":maincpu"]
    space = cpu.spaces["program"]
  end
  if frame == 900 then
    local t = {}
    for a = 0x3E0000, 0x3EFFFF do t[#t + 1] = string.char(space:read_u8(a)) end
    local fh = io.open("D:/repos/crenellation/romlab/out/boot/ram900.bin", "wb")
    fh:write(table.concat(t)); fh:close()
    manager.machine:exit()
  end
end)
