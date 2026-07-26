-- Verify remap_rect at 0x1217E.
--   remap_rect(long dest @+4, long table @+8, long width @+12, long height @+16)
-- For each pixel in a width x height rectangle: bank = pixel >> 4,
-- colour = pixel & 0x0F, write colour + table[bank]. Rows advance by 0x200.
local OUT="D:/repos/crenellation/romlab/out/verify4/"
local log=io.open(OUT.."v.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local ENTRY=0x1217E
local SENTINEL=0x0FFFF0
local DEST=0x210000
local TABLE=0x3E2800
local STACK=0x3E2000
local CASES={
  { name="m0", w=8,  h=8,  seed=1, tbl=0 },
  { name="m1", w=16, h=4,  seed=2, tbl=1 },
  { name="m2", w=4,  h=16, seed=3, tbl=2 },
  { name="m3", w=12, h=12, seed=4, tbl=3 },
  { name="m4", w=32, h=2,  seed=5, tbl=1 },
  { name="m5", w=8,  h=8,  seed=6, tbl=2 },
}
local REGS={"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}
local frame,idx,saved,returned=0,1,nil,false
local phase="idle"
local function save() local s={} for _,r in ipairs(REGS) do local ok,v=pcall(function() return cpu.state[r].value end); if ok then s[r]=v end end return s end
local function restore(s) for _,r in ipairs(REGS) do if s[r] then pcall(function() cpu.state[r].value=s[r] end) end end end
local function install() TAPS[#TAPS+1]=space:install_read_tap(SENTINEL,SENTINEL+1,"d",function(o,d,m) returned=true return d end) end
local function seed_all(c)
  local v=c.seed
  for row=0,c.h-1 do
    for col=0,c.w-1 do
      v=(v*61+29)%256
      space:write_u8(DEST+row*512+col, v)
    end
  end
  -- 16-entry remap table, deterministic per variant
  for i=0,15 do space:write_u8(TABLE+i, (i*17 + c.tbl*40) % 256) end
end
local function dump(name,c)
  local t={}
  for row=0,c.h-1 do for col=0,c.w-1 do t[#t+1]=string.char(space:read_u8(DEST+row*512+col)) end end
  local fh=io.open(OUT..name..".bin","wb"); fh:write(table.concat(t)); fh:close()
  local t2={}
  for i=0,15 do t2[#t2+1]=string.char(space:read_u8(TABLE+i)) end
  fh=io.open(OUT..name..".tbl","wb"); fh:write(table.concat(t2)); fh:close()
end
local function start(c)
  saved=save(); seed_all(c); dump(c.name.."-in", c)
  local sp=STACK
  sp=sp-4; space:write_u32(sp, c.h)
  sp=sp-4; space:write_u32(sp, c.w)
  sp=sp-4; space:write_u32(sp, TABLE)
  sp=sp-4; space:write_u32(sp, DEST)
  sp=sp-4; space:write_u32(sp, SENTINEL)
  cpu.state["SP"].value=sp
  cpu.state["PC"].value=ENTRY
  returned=false
end
emu.register_frame_done(function()
  frame=frame+1
  if frame==300 then install(); phase="run"; return end
  if phase~="run" then return end
  if idx>#CASES then log:write("done"..NL); log:flush(); manager.machine:exit(); return end
  local c=CASES[idx]
  if not saved then
    start(c); log:write(string.format("case %s w=%d h=%d seed=%d tbl=%d",c.name,c.w,c.h,c.seed,c.tbl)..NL); log:flush(); return
  end
  if returned then dump(c.name.."-out", c); log:write("  ok"..NL)
  else log:write(string.format("  NO RETURN pc=%06X",cpu.state["PC"].value)..NL) end
  log:flush(); restore(saved); saved=nil; idx=idx+1
end)
