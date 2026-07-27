-- What does the chip actually stack for an address error?
--
-- The port implements the seven-word frame from the manual and the reset-path
-- snapshots still do not reproduce, so the frame or the moment it is taken is
-- wrong. This faults the chip deliberately - `move.w (a0), d0` with a0 odd -
-- and dumps what ends up on the stack.
local f = io.open("D:/repos/crenellation/romlab/out/faultframe.txt", "w")
local NL = string.char(10)
local frame = 0
local CODE, STACK = 0x3E6000, 0x3E5000
emu.register_frame_done(function()
  frame = frame + 1
  local cpu = manager.machine.devices[":maincpu"]
  local sp = cpu.spaces["program"]
  if frame == 400 then
    -- a known pattern under the stack so the pushed words stand out
    for i = 1, 32 do sp:write_u8(STACK - i, 0xEE) end
    sp:write_u16(CODE, 0x3010)          -- move.w (a0), d0
    sp:write_u16(CODE + 2, 0x60FE)      -- and park, if it ever gets there
    cpu.state["A0"].value = 0x3E4001    -- odd: this is the fault
    cpu.state["SP"].value = STACK
    cpu.state["SR"].value = 0x2700
    cpu.state["PC"].value = CODE
    f:write(string.format("before: pc=%05X sp=%06X a0=%06X sr=%04X",
      CODE, STACK, 0x3E4001, 0x2700) .. NL)
    return
  end
  if frame == 402 then
    f:write(string.format("after:  pc=%06X sp=%06X", cpu.state["PC"].value,
      cpu.state["SP"].value) .. NL)
    f:write("vector at 0x0C = " .. string.format("%06X", sp:read_u32(0x0C)) .. NL)
    local s = cpu.state["SP"].value
    local t = {}
    for i = 0, 15 do t[#t + 1] = string.format("%02X", sp:read_u8(s + i)) end
    f:write("stack at sp: " .. table.concat(t, " ") .. NL)
    local u = {}
    for i = 1, 20 do u[#u + 1] = string.format("%02X", sp:read_u8(STACK - i)) end
    f:write("below STACK: " .. table.concat(u, " ") .. NL)
    f:flush()
    manager.machine:exit()
  end
end)
