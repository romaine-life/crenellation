-- What 0x640000 reads at the moment the game reads it. Sampling between frames
-- shows 0xFF, but the handler branches on bit 3 being clear, so the bit must be
-- low only during part of the frame.
local f = io.open("D:/repos/crenellation/romlab/out/inprobe.txt", "w")
local NL = string.char(10)
local cpu, space
local frame, n = 0, 0
local taps = {}
emu.register_frame_done(function()
  frame = frame + 1
  if cpu == nil then
    cpu = manager.machine.devices[":maincpu"]
    space = cpu.spaces["program"]
    taps[#taps + 1] = space:install_read_tap(0x640000, 0x640007, "in",
      function(offset, d, mask)
        if n < 24 then
          n = n + 1
          f:write(string.format("read 0x%06X -> 0x%04X  from pc 0x%05X  frame %d",
            offset, d & 0xFFFF, cpu.state["CURPC"].value, frame) .. NL)
          f:flush()
        end
        return d
      end)
  end
  if frame >= 400 then manager.machine:exit() end
end)
