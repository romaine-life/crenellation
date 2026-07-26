-- The dissolve tail-calls instead of returning, so the sentinel trick will not
-- work. Verify it by sequence instead: record the framebuffer offsets it
-- clears, in order, and compare against the ported LFSR.
local OUT="D:/repos/crenellation/romlab/out/dissolve/"
local log=io.open(OUT.."d.log","w")
local NL=string.char(10)
local cpu=manager.machine.devices[":maincpu"]
local space=cpu.spaces["program"]
local TAPS={}
local frame=0
local seq={}
local capturing=false
local fh=nil
local function install()
  TAPS[#TAPS+1]=space:install_write_tap(0x200000,0x21FFFF,"w",function(offset,data,mask)
    if cpu.state["CURPC"].value==0x11E44 and fh then
      fh:write(string.format("%X",offset-0x200000)..NL)
    end
    return data
  end)
end
emu.register_frame_done(function()
  frame=frame+1
  if frame==400 then
    install()
    fh=io.open(OUT.."order.txt","w")
    log:write("capturing dissolve order"..NL); log:flush()
  end
  if frame==6000 then
    if fh then fh:close(); fh=nil end
    log:write("done"..NL); log:flush()
    manager.machine:exit()
  end
end)
