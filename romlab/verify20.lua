-- Verify the projectile integration at 0x7008.
-- Shot records are 0x1A bytes in the ring at 0x3E0F48. The routine advances
-- position by velocity in 1/64 units, advances a separate height by its own
-- velocity, decrements that vertical velocity by one (gravity), and writes the
-- projected screen position into the sprite record at record+0x16.
--
-- The routine has no link, so it uses a6-relative locals set up by its caller -
-- the harness has to point a6 at scratch itself.
local OUT = "D:/repos/crenellation/romlab/out/verify20/"
local log = io.open(OUT .. "v.log", "w")
local NL = string.char(10)
local cpu = manager.machine.devices[":maincpu"]
local space = cpu.spaces["program"]
local TAPS = {}
local ENTRY, SENTINEL, STACK = 0x7008, 0x0FFFF0, 0x3E2000
local RING = 0x3E0F48
local SPRITE, FRAME = 0x3E2900, 0x3E2A00
local REGS = {"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}

local CASES = {
  { n="flat",   vx=64,  x=0,      vy=0,   y=0,      vz=0,  h=0    },
  { n="rise",   vx=64,  x=0,      vy=32,  y=0,      vz=20, h=100  },
  { n="apex",   vx=128, x=6400,   vy=64,  y=3200,   vz=1,  h=500  },
  { n="fall",   vx=128, x=6400,   vy=64,  y=3200,   vz=-5, h=200  },
  { n="land",   vx=128, x=6400,   vy=64,  y=3200,   vz=-5, h=3    },
  { n="neg",    vx=-96, x=12800,  vy=-48, y=9600,   vz=10, h=250  },
  { n="fast",   vx=512, x=100,    vy=256, y=200,    vz=40, h=1000 },
  { n="zero",   vx=0,   x=0,      vy=0,   y=0,      vz=1,  h=1    },
  { n="big",    vx=1000,x=30000,  vy=800, y=20000,  vz=60, h=2000 },
  { n="vzone",  vx=64,  x=1000,   vy=64,  y=1000,   vz=1,  h=50   },
}
local frame, ci, saved, returned, waited = 0, 1, nil, false, 0
local phase = "idle"
local function save_state()
  local s={} for _,r in ipairs(REGS) do local ok,v=pcall(function() return cpu.state[r].value end); if ok then s[r]=v end end
  return s
end
local function restore_state(s)
  for _,r in ipairs(REGS) do if s[r] then pcall(function() cpu.state[r].value=s[r] end) end end
end
local function install()
  TAPS[#TAPS+1]=space:install_read_tap(SENTINEL,SENTINEL+1,"d",function(o,d,m) returned=true; return d end)
end
local function w16(a,v) space:write_u16(a, v % 0x10000) end
local function start_case(c)
  saved = save_state()
  for r = 0, 2 do
    local base = ({RING, 0x3E1254, 0x3E1560})[r+1]
    for i = 0, 0x1A*8-1 do space:write_u8(base + i, 0) end
  end
  for i = 0, 0x40 do space:write_u8(SPRITE + i, 0) end
  for i = 0, 0x60 do space:write_u8(FRAME - 0x30 + i, 0) end
  w16(RING + 0x06, c.vx); w16(RING + 0x08, c.x)
  w16(RING + 0x0A, c.vy); w16(RING + 0x0C, c.y)
  w16(RING + 0x0E, c.vz); w16(RING + 0x10, c.h)
  w16(RING + 0x12, 1234); w16(RING + 0x14, 567)
  space:write_u32(RING + 0x16, SPRITE)
  space:write_u8(RING + 0x02, 0)
  local sp = STACK
  sp = sp - 4; space:write_u32(sp, SENTINEL)
  cpu.state["SP"].value = sp
  cpu.state["A6"].value = FRAME
  cpu.state["PC"].value = ENTRY
  returned = false; waited = 0
end
emu.register_frame_done(function()
  frame = frame + 1
  if frame == 600 then install(); phase="run"; return end
  if phase ~= "run" then return end
  if ci > #CASES then log:write("done"..NL); log:flush(); manager.machine:exit(); return end
  local c = CASES[ci]
  if not saved then start_case(c); return end
  waited = waited + 1
  if returned then
    log:write(string.format("S %s %04X %04X %04X %04X %04X %04X %08X %04X %04X", c.n,
      space:read_u16(RING+0x06), space:read_u16(RING+0x08),
      space:read_u16(RING+0x0A), space:read_u16(RING+0x0C),
      space:read_u16(RING+0x0E), space:read_u16(RING+0x10),
      space:read_u32(RING+0x16),
      space:read_u16(SPRITE+0x06), space:read_u16(SPRITE+0x08))..NL)
  elseif waited < 3 then return
  else log:write(string.format("S %s NORETURN", c.n)..NL) end
  log:flush(); restore_state(saved); saved=nil; ci=ci+1
end)
