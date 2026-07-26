-- Dump the board mid-build so its terrain codes can be read.
local OUT = "D:/repos/crenellation/romlab/out/boardread/"
local log = io.open(OUT .. "b.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local BOARD = 0x3E0864
local frame, tx, ty, n = 0, 0, 0, 0
local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end
emu.register_frame_done(function()
  frame = frame + 1
  if frame > 600 and frame < 12000 then
    local c = frame % 240
    if c == 0 then set(":IN1","Coin 1",1) end
    if c == 20 then set(":IN1","Coin 1",0) end
    if c == 40 then set(":IN1","P1 Button 1",1) end
    if c == 50 then set(":IN1","P1 Button 1",0) end
  end
  if frame > 900 then
    tx=(tx+7)%256; ty=(ty+11)%256
    set(":TRACK3","Trackball X",tx); set(":TRACK2","Trackball Y",ty)
    local q = frame % 45
    if q == 0 then set(":IN1","P1 Button 1",1) end
    if q == 6 then set(":IN1","P1 Button 1",0) end
  end
  for _, f in ipairs({1500, 2039, 2600, 3300, 4200, 5600}) do
    if frame == f then
      local t = {}
      for i = 0, 42*32-1 do t[#t+1] = string.char(space:read_u8(BOARD + i)) end
      local fh = io.open(OUT.."board-"..f..".bin","wb"); fh:write(table.concat(t)); fh:close()
      log:write(string.format("B %d phase %d cd %d", f,
        space:read_u8(0x3E195C), space:read_u8(0x3E1870))..NL)
      log:flush()
    end
  end
  if frame == 6000 then log:write("done"..NL); log:flush(); manager.machine:exit() end
end)
