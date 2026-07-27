-- Which instructions fill the sound channel table. The port leaves that area
-- all zeros where the chip has data, so rather than guess at which routine
-- should have run, ask the chip which one does.
local f = io.open("D:/repos/crenellation/romlab/out/boot/whowrites.txt", "w")
local NL = string.char(10)
local cpu, space
local frame = 0
local taps = {}
local who = {}
emu.register_frame_done(function()
  frame = frame + 1
  if cpu == nil then
    cpu = manager.machine.devices[":maincpu"]
    space = cpu.spaces["program"]
    taps[#taps + 1] = space:install_write_tap(0x3E3440, 0x3E34A0, "w",
      function(offset, d, mask)
        local pc = cpu.state["CURPC"].value
        who[pc] = (who[pc] or 0) + 1
        return d
      end)
  end
  if frame == 900 then
    local rows = {}
    for pc, n in pairs(who) do rows[#rows + 1] = { pc = pc, n = n } end
    table.sort(rows, function(a, b) return a.n > b.n end)
    for i = 1, math.min(#rows, 14) do
      f:write(string.format("%05X wrote %d times", rows[i].pc, rows[i].n) .. NL)
    end
    f:flush()
    manager.machine:exit()
  end
end)
