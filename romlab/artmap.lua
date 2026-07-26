-- Capture tile placements with frame numbers plus framebuffer checkpoints, so
-- screens can be rebuilt as (tile source, palette, position) maps and the
-- rebuild checked against the real screen.
local OUT = "D:/repos/crenellation/romlab/out/artmap/"
local log = io.open(OUT .. "map.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local frame, recording, n = 0, false, 0
local tx, ty = 0, 0
local DECOMP = 0x11F1C

local function fld(p,f) local q=manager.machine.ioport.ports[p]; return q and q.fields[f] or nil end
local function set(p,f,v) local q=fld(p,f); if q then pcall(function() q:set_value(v) end) end end

local function install()
  TAPS[#TAPS+1] = space:install_read_tap(DECOMP, DECOMP+1, "e", function(o,d,m)
    if recording then
      n = n + 1
      log:write(string.format("C %d %06X %06X %d %d", frame,
        cpu.state["A0"].value, cpu.state["A1"].value,
        cpu.state["D2"].value & 0xFFFF, cpu.state["D4"].value & 0xFFFF)..NL)
    end
    return d
  end)
end

local function snap(tag)
  local bmp = manager.machine.memory.shares[":bitmap"]
  local t = {}
  for i = 0, bmp.size-1 do t[#t+1] = string.char(bmp:read_u8(i)) end
  local fh = io.open(OUT.."fb-"..tag..".bin","wb"); fh:write(table.concat(t)); fh:close()
  local pal = manager.machine.memory.shares[":palette"]
  local pt = {}
  for i = 0, pal.size-1 do pt[#pt+1] = string.char(pal:read_u8(i)) end
  fh = io.open(OUT.."pal-"..tag..".bin","wb"); fh:write(table.concat(pt)); fh:close()
  log:write("SNAP "..tag.." "..frame..NL); log:flush()
end

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 400 then install() end
  if frame == 500 then recording = true end
  if frame > 900 and frame < 4000 then
    local c = frame % 240
    if c == 0 then set(":IN1","Coin 1",1) end
    if c == 20 then set(":IN1","Coin 1",0) end
    if c == 40 then set(":IN1","P1 Button 1",1) end
    if c == 50 then set(":IN1","P1 Button 1",0) end
  end
  if frame > 1200 then
    tx=(tx+7)%256; ty=(ty+11)%256
    set(":TRACK3","Trackball X",tx); set(":TRACK2","Trackball Y",ty)
    local q = frame % 45
    if q == 0 then set(":IN1","P1 Button 1",1) end
    if q == 6 then set(":IN1","P1 Button 1",0) end
  end
  for _, f in ipairs({700, 1100, 1600, 2200, 3000, 4200, 5600, 7000, 8500}) do
    if frame == f then snap(tostring(f)) end
  end
  if frame == 9000 then
    recording = false; log:write("tiles "..n..NL); log:flush(); manager.machine:exit()
  end
end)
