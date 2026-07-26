-- Enumerate memory shares/regions/banks (defensively — the Lua API's field
-- names drift between MAME versions, so tostring everything and pcall the
-- optional bits). The goal is to find the bitmap playfield RAM.
local path = "D:/repos/crenellation/romlab/out/mem.txt"
local out = io.open(path, "w")

local function line(s) out:write(s .. "\n") end

line("=== memory shares (RAM the driver names) ===")
local ok, err = pcall(function()
  for name, share in pairs(manager.machine.memory.shares) do
    line(string.format("share  %-28s size=%s width=%s", tostring(name), tostring(share.size), tostring(share.bitwidth)))
  end
end)
if not ok then line("  shares failed: " .. tostring(err)) end

line("")
line("=== memory regions (ROM) ===")
ok, err = pcall(function()
  for name, region in pairs(manager.machine.memory.regions) do
    line(string.format("region %-28s size=%s", tostring(name), tostring(region.size)))
  end
end)
if not ok then line("  regions failed: " .. tostring(err)) end

line("")
line("=== devices ===")
ok, err = pcall(function()
  for tag, dev in pairs(manager.machine.devices) do
    line(string.format("device %s", tostring(tag)))
  end
end)
if not ok then line("  devices failed: " .. tostring(err)) end

line("")
line("=== screen geometry ===")
ok, err = pcall(function()
  for tag, scr in pairs(manager.machine.screens) do
    line(string.format("screen %s  %sx%s", tostring(tag), tostring(scr.width), tostring(scr.height)))
  end
end)
if not ok then line("  screens failed: " .. tostring(err)) end

out:close()
manager.machine:exit()
