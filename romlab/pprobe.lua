-- Can the debugger single-step under -debugger none? A breakpoint does not
-- halt, but step() may still advance one instruction at a time, which is all
-- the capture needs to read state at a true boundary.
local f = io.open("D:/repos/crenellation/romlab/out/pprobe.txt", "w")
local NL = string.char(10)
local frames, steps = 0, 0
local started = false
emu.register_periodic(function()
  if not started then return end
  local cpu = manager.machine.devices[":maincpu"]
  if steps < 12 then
    f:write(string.format("step %d: pc=%06X state=%s", steps,
      cpu.state["PC"].value, tostring(manager.machine.debugger.execution_state)) .. NL)
    f:flush()
    -- take several in one callback: if step() only takes effect on returning
    -- to the emulator, the pc will advance by one no matter how many are asked
    cpu.debug:step(); cpu.debug:step(); cpu.debug:step()
    steps = steps + 1
  elseif steps == 12 then
    steps = 13
    manager.machine:exit()
  end
end)
emu.register_frame_done(function()
  frames = frames + 1
  if frames == 60 then
    manager.machine.debugger.execution_state = "stop"
    started = true
  end
end)
