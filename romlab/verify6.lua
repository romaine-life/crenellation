-- Verify the RNG at 0x11E58.  random(long n @+4) -> long
-- Stateful: the 16-bit seed lives at 0x3E0842 and is updated on every call.
-- Capture the return value (d0 at the moment of return) AND the new seed.
local OUT="D:/repos/crenellation/romlab/out/verify6/"
local log=io.open(OUT.."v.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local ENTRY=0x11E58
local SENTINEL=0x0FFFF0
local STACK=0x3E2000
local SEED=0x3E0842
local CASES={}
local seeds={0x0000,0x1234,0x7FFF,0x8000,0xABCD,0xFFFF,0x0001,0x5D35}
local ns={1,2,3,4,6,7,9,16,21,100,255,1000}
for _,s in ipairs(seeds) do
  for _,n in ipairs(ns) do CASES[#CASES+1]={seed=s,n=n} end
end
local REGS={"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}
local frame,idx,saved,returned,retval=0,1,nil,false,0
local phase="idle"
local function save() local s={} for _,r in ipairs(REGS) do local ok,v=pcall(function() return cpu.state[r].value end); if ok then s[r]=v end end s.seed=space:read_u16(SEED) return s end
local function restore(s) for _,r in ipairs(REGS) do if s[r] then pcall(function() cpu.state[r].value=s[r] end) end end pcall(function() space:write_u16(SEED,s.seed) end) end
local function install()
  TAPS[#TAPS+1]=space:install_read_tap(SENTINEL,SENTINEL+1,"d",function(o,d,m)
    if not returned then retval=cpu.state["D0"].value; returned=true end
    return d
  end)
end
emu.register_frame_done(function()
  frame=frame+1
  if frame==300 then install(); phase="run"; return end
  if phase~="run" then return end
  if idx>#CASES then log:write("done"..NL); log:flush(); manager.machine:exit(); return end
  local c=CASES[idx]
  if not saved then
    saved=save()
    space:write_u16(SEED, c.seed)
    local sp=STACK
    sp=sp-4; space:write_u32(sp, c.n)
    sp=sp-4; space:write_u32(sp, SENTINEL)
    cpu.state["SP"].value=sp
    cpu.state["PC"].value=ENTRY
    returned=false; retval=0
    return
  end
  if returned then
    log:write(string.format("R seed=%04X n=%d ret=%08X newseed=%04X", c.seed, c.n, retval & 0xFFFFFFFF, space:read_u16(SEED))..NL)
  else
    log:write(string.format("R seed=%04X n=%d NORETURN", c.seed, c.n)..NL)
  end
  log:flush(); restore(saved); saved=nil; idx=idx+1
end)
