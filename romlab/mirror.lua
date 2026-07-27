-- Are the extra readable regions mirrors of something already modelled?
-- A mirror can be folded with an address mask; anything else has to be
-- snapshotted, which is far more expensive.
local f = io.open("D:/repos/crenellation/romlab/out/mirror.txt", "w")
local NL = string.char(10)
local frame = 0
local REGIONS = {0x140000, 0x500000, 0x540000, 0x800000, 0x940000, 0xC60000, 0xD00000, 0xD40000}
emu.register_frame_done(function()
  frame = frame + 1
  if frame ~= 400 then return end
  local sp = manager.machine.devices[":maincpu"].spaces["program"]
  local function sig(base)
    local t = {}
    for _, off in ipairs({0, 0x100, 0x2000, 0x1F000}) do
      t[#t + 1] = string.format("%04X", sp:read_u16(base + off))
    end
    return table.concat(t, " ")
  end
  f:write("ROM   000000: " .. sig(0x000000) .. NL)
  f:write("RAM   3E0000: " .. sig(0x3E0000) .. NL)
  for _, r in ipairs(REGIONS) do
    f:write(string.format("      %06X: %s", r, sig(r)) .. NL)
  end
  f:flush()
  manager.machine:exit()
end)
