-- Verify the screen dissolve at 0x11E10.
-- It clears the framebuffer in pseudo-random order: an LFSR seeded with
-- 0xB400, stepping lsr/eor, rejecting values >= 0xF000, clearing a word at
-- 2*value each iteration, 0xF001 iterations. It also clears word 0 and
-- 0x3C0000. Seed the framebuffer with a pattern so the clear order shows.
local OUT="D:/repos/crenellation/romlab/out/verify5/"
local log=io.open(OUT.."v.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local ENTRY=0x11E10
local SENTINEL=0x0FFFF0
local STACK=0x3E2000
local BITMAP=0x200000
local REGS={"D0","D1","D2","D3","D4","D5","D6","D7","A0","A1","A2","A3","A4","A5","A6","SP","PC","SR"}
local frame,saved,returned,done=0,nil,false,false
local started=0
local phase="idle"
local function save() local s={} for _,r in ipairs(REGS) do local ok,v=pcall(function() return cpu.state[r].value end); if ok then s[r]=v end end return s end
local function restore(s) for _,r in ipairs(REGS) do if s[r] then pcall(function() cpu.state[r].value=s[r] end) end end end
local function install() TAPS[#TAPS+1]=space:install_read_tap(SENTINEL,SENTINEL+1,"d",function(o,d,m) returned=true return d end) end
emu.register_frame_done(function()
  frame=frame+1
  if frame==300 then install(); phase="run"; return end
  if phase~="run" or done then return end
  if not saved then
    saved=save()
    -- fill the framebuffer with a known non-zero pattern
    for i=0,0x1FFFF,2 do space:write_u16(BITMAP+i, 0xA55A) end
    local sp=STACK
    sp=sp-4; space:write_u32(sp, SENTINEL)
    cpu.state["SP"].value=sp
    cpu.state["PC"].value=ENTRY
    returned=false
    started=frame
    log:write("dissolve started"..NL); log:flush()
    return
  end
  if not returned and frame-started < 30 then return end
  if returned then
    local t={}
    for i=0,0x1FFFF do t[#t+1]=string.char(space:read_u8(BITMAP+i)) end
    local fh=io.open(OUT.."after.bin","wb"); fh:write(table.concat(t)); fh:close()
    local cleared=0
    for i=1,#t do if t[i]==string.char(0) then cleared=cleared+1 end end
    log:write(string.format("returned; %d of %d bytes cleared",cleared,#t)..NL)
  else
    log:write(string.format("NO RETURN pc=%06X",cpu.state["PC"].value)..NL)
  end
  log:flush(); restore(saved); done=true
  manager.machine:exit()
end)
