-- The addresses the chip executes from reset, so the port can be compared.
--
-- The port boots, runs its main loop and handler, and then waits forever on a
-- sound handshake that never completes. Reasoning about the sound driver has
-- not settled it. This does what settled everything else: record what the chip
-- actually does and find the first place the port does something different.
--
-- A full trace is far too much - the port runs twelve million instructions in
-- ten seconds of game time - so this records the first time each address is
-- reached, in order. That is a few thousand entries and it is enough to find a
-- path taken on one side and not the other.
local OUT = "D:/repos/crenellation/romlab/out/boot/"
local log = io.open(OUT .. "b.log", "w")
local NL = string.char(10)

local cpu, space
local seen = {}
local order = {}
local count = 0
local LIMIT = 20000
local taps = {}
local started = false
local frame = 0

emu.register_frame_done(function()
  frame = frame + 1
  if cpu == nil then
    cpu = manager.machine.devices[":maincpu"]
    space = cpu.spaces["program"]
  end
  -- from the very first frame: this is about the boot path, so the machine is
  -- left to come up on its own with nothing driven
  if not started then
    started = true
    taps[#taps + 1] = space:install_read_tap(0x000000, 0x01FFFF, "boot",
      function(offset, d, mask)
        if count >= LIMIT then return d end
        local pc = cpu.state["CURPC"].value
        if seen[pc] == nil then
          seen[pc] = true
          count = count + 1
          order[#order + 1] = pc
        end
        return d
      end)
  end
  if frame == 900 then
    for i, a in ipairs(order) do
      log:write(string.format("%05X", a) .. NL)
    end
    log:write("# distinct addresses " .. #order .. " over " .. frame .. " frames" .. NL)
    log:flush()
    manager.machine:exit()
  end
end)
