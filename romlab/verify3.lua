-- Verify recolor_block at 0x11FF8.
--   recolor_block(long dest @+4, long palette_base @+8; the word at +10 is read)
-- For each of 8 rows it takes 8 pixels, keeps the low nibble and adds the
-- palette base, then advances a full row (+0x1F8). Seed the destination with a
-- known pattern first so the transformation is observable.
local OUT="D:/repos/crenellation/romlab/out/verify3/"
local log=io.open(OUT.."verify3.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local ENTRY=0x11FF8
local SENTINEL=0x0FFFF0
local DEST=0x210000
local STACK=0x3E2000
local CASES={
  { name="r0", pal=0x00, seed=1 },
  { name="r1", pal=0x10, seed=2 },
  { name="r2", pal=0xB0, seed=3 },
  { name="r3", pal=0x20, seed=4 },
  { name="r4", pal=0xF0, seed=5 },
  { name="r5", pal=0x50, seed=6 },
}
local REGS={"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}
local frame,idx,saved,returned=0,1,nil,false
local phase="idle"
local function save() local s={} for _,r in ipairs(REGS) do local ok,v=pcall(function() return cpu.state[r].value end); if ok then s[r]=v end end return s end
local function restore(s) for _,r in ipairs(REGS) do if s[r] then pcall(function() cpu.state[r].value=s[r] end) end end end
local function install()
  TAPS[#TAPS+1]=space:install_read_tap(SENTINEL,SENTINEL+1,"done",function(o,d,m) returned=true return d end)
end
local function seed_dest(seed)
  -- deterministic pattern the port can reproduce exactly
  local v=seed
  for row=0,7 do
    for col=0,7 do
      v=(v*37+11)%256
      space:write_u8(DEST+row*512+col, v)
    end
  end
end
local function dump(name)
  local t={}
  for row=0,7 do
    for col=0,7 do t[#t+1]=string.char(space:read_u8(DEST+row*512+col)) end
  end
  local fh=io.open(OUT..name..".bin","wb"); fh:write(table.concat(t)); fh:close()
end
local function start(c)
  saved=save()
  seed_dest(c.seed)
  dump(c.name.."-in")
  local sp=STACK
  sp=sp-4; space:write_u32(sp, c.pal)
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
    start(c)
    log:write(string.format("case %s pal=%02X seed=%d",c.name,c.pal,c.seed)..NL); log:flush()
    return
  end
  if returned then dump(c.name.."-out"); log:write("  ok"..NL)
  else log:write(string.format("  NO RETURN pc=%06X",cpu.state["PC"].value)..NL) end
  log:flush(); restore(saved); saved=nil; idx=idx+1
end)
