-- Watch wall cells every frame and log only the changes, so a long session can
-- run cheaply. A burst of new connected cells in one frame is a piece drop, and
-- its shape is the piece.
local OUT="D:/repos/crenellation/romlab/out/wallwatch/"
local log=io.open(OUT.."walls.log","w")
local NL=string.char(10)
local frame=0
local WALL={[32]=true,[37]=true,[38]=true,[39]=true,[40]=true,[41]=true,[42]=true,[43]=true,[45]=true,[56]=true,[76]=true,[80]=true,[86]=true,[87]=true,[88]=true,[89]=true,[90]=true,[91]=true,[92]=true,[224]=true,[237]=true,[253]=true,[254]=true}
local COLS,ROWS,CELL,STRIDE=21,15,16,512
local prev={}
local function fld(p,n) local port=manager.machine.ioport.ports[p]; return port and port.fields[n] or nil end
local function set(p,n,v) local f=fld(p,n); if f then pcall(function() f:set_value(v) end) end end
emu.register_frame_done(function()
  frame=frame+1
  if frame>600 then
    local c=frame%240
    if c==0 then set(":IN1","Coin 1",1) end
    if c==20 then set(":IN1","Coin 1",0) end
    -- fire steadily; placements land wherever the cursor happens to be
    local q=frame%25
    if q==0 then set(":IN1","P1 Button 1",1); set(":IN0","P2 Button 1",1) end
    if q==7 then set(":IN1","P1 Button 1",0); set(":IN0","P2 Button 1",0) end
  end
  if frame>1500 then
    local ok=pcall(function()
      local bmp=manager.machine.memory.shares[":bitmap"]
      local added={}
      for cy=0,ROWS-1 do
        for cx=0,COLS-1 do
          local i=cy*COLS+cx
          local hit=false
          for _,off in ipairs({{4,4},{11,4},{4,11},{11,11},{8,8}}) do
            local v=bmp:read_u8((cy*CELL+off[2])*STRIDE + cx*CELL+off[1])
            if WALL[v] then hit=true break end
          end
          local was=prev[i] or false
          if hit and not was then added[#added+1]=i end
          prev[i]=hit
        end
      end
      if #added>=2 and #added<=6 then
        local parts={}
        for _,i in ipairs(added) do parts[#parts+1]=tostring(i) end
        log:write(frame.." "..table.concat(parts,",")..NL); log:flush()
      end
    end)
  end
  if frame>60000 then manager.machine:exit() end
end)
