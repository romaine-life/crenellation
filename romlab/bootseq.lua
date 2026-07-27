-- The chip's instruction addresses in sequence, not deduplicated.
--
-- Comparing sets of addresses says what each side never reached; comparing the
-- order they are first reached is noisy, because taking an interrupt a few
-- instructions earlier reorders everything after it. The sequence itself is
-- neither: the first index where the two disagree is the instruction where the
-- port stopped doing what the chip does.
local OUT = "D:/repos/crenellation/romlab/out/boot/"
local log = io.open(OUT .. "seq.log", "w")
local NL = string.char(10)
local cpu, space
local frame, n = 0, 0
local LIMIT = 6000000
local taps = {}
local buf = {}
local last = -1
local lastsr = -1

-- A periodic callback fires during emulation rather than after a frame, so
-- the tap goes in far earlier - the reset code spends a long time clearing the
-- playfield, and catching it from inside the first frame gets most of the boot
-- that a frame callback misses entirely.
emu.register_periodic(function()
  if cpu ~= nil then return end
  cpu = manager.machine.devices[":maincpu"]
  space = cpu.spaces["program"]
  taps[#taps + 1] = space:install_read_tap(0x000000, 0x01FFFF, "seq",
    function(offset, d, mask)
      if n >= LIMIT then return d end
      local pc = cpu.state["CURPC"].value
      if pc ~= last then
        last = pc
        n = n + 1
        buf[#buf + 1] = string.format("%05X", pc)
        if #buf >= 4096 then
          log:write(table.concat(buf, NL) .. NL)
          buf = {}
        end
      end
      return d
    end)
end)

emu.register_frame_done(function()
  frame = frame + 1
  if cpu == nil then
    cpu = manager.machine.devices[":maincpu"]
    space = cpu.spaces["program"]
    taps[#taps + 1] = space:install_read_tap(0x000000, 0x01FFFF, "seq",
      function(offset, d, mask)
        if n >= LIMIT then return d end
        local pc = cpu.state["CURPC"].value
        -- the tap fires on every fetch, and an instruction with extension
        -- words fires several times at the same address
        if pc ~= last then
          last = pc
          n = n + 1
          -- The status register alongside the address, but only when it
          -- changes. The two sides run identical instruction sequences for
          -- millions of instructions and still end up with different masks, so
          -- the address alone cannot show where it went wrong. Logging every
          -- change keeps this small and names the instruction exactly.
          -- only the mask matters here; the condition codes change constantly
          local sr = (cpu.state["SR"].value // 256) % 8
          if sr ~= lastsr then
            lastsr = sr
            buf[#buf + 1] = string.format("%05X M%d", pc, sr)
          else
            buf[#buf + 1] = string.format("%05X", pc)
          end
          if #buf >= 4096 then
            log:write(table.concat(buf, NL) .. NL)
            buf = {}
          end
        end
        return d
      end)
  end
  if n >= LIMIT or frame >= 900 then
    if #buf > 0 then log:write(table.concat(buf, NL) .. NL) end
    log:write("# " .. n .. " addresses over " .. frame .. " frames" .. NL)
    log:flush()
    manager.machine:exit()
  end
end)
