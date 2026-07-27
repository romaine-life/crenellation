-- The sound work area as the chip leaves it, so the port's can be diffed
-- against it. The port waits for a queue to drain that never does; this says
-- which variable actually differs rather than which one looks suspicious.
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
    for a = 0x3E3400, 0x3E37FF do t[#t + 1] = string.char(space:read_u8(a)) end
    local fh = io.open("D:/repos/crenellation/romlab/out/boot/sound.bin", "wb")
    fh:write(table.concat(t)); fh:close()
    manager.machine:exit()
  end
end)
