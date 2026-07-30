# Rerun the capture-matrix cells that have no complete log. A complete log
# ends with its done-line; anything else is a run MAME hung on - the freeze-
# restore tap occasionally wedges the machine, emulated time stops, and
# -seconds_to_run never fires. So each run gets a wall-clock watchdog and up
# to three attempts.
$step = 'D:\repos\crenellation\romlab\out\step'
$lua = 'D:\repos\crenellation\.claude\worktrees\full-decompilation-continuation-fea13d\romlab\stepnew.lua'
$nv = 'D:\repos\crenellation\.claude\worktrees\full-decompilation-continuation-fea13d\romlab\nvram_orig'
$ee = 'D:\repos\crenellation\.claude\worktrees\full-decompilation-continuation-fea13d\romlab\eeprom-original.bin'

foreach ($shape in 0, 1, 2, 3) {
  foreach ($n in 1, 2, 3, 5, 10, 20, 60, 200) {
    $log = Join-Path $step "sn$shape-$n.log"
    $done = (Test-Path $log) -and ((Get-Content $log -Tail 1) -match '^done ')
    if ($done) { continue }
    for ($try = 1; $try -le 3 -and -not $done; $try++) {
      Write-Output "shape $shape steps $n (attempt $try)"
      New-Item -ItemType Directory -Force (Join-Path $nv 'rampart') | Out-Null
      Copy-Item $ee (Join-Path $nv 'rampart\eeprom') -Force
      $env:STEPSHAPE = "$shape"; $env:STEPN = "$n"
      $p = Start-Process -FilePath 'D:\Emulation\MAME\mame.exe' -ArgumentList @(
        'rampart', '-rompath', 'D:\repos\crenellation\romlab\roms',
        '-nvram_directory', $nv, '-video', 'none', '-sound', 'none',
        '-nothrottle', '-skip_gameinfo', '-autoboot_script', $lua,
        '-autoboot_delay', '1', '-seconds_to_run', '240'
      ) -PassThru -WindowStyle Hidden
      if (-not $p.WaitForExit(300000)) {
        Write-Output "  hung; killing pid $($p.Id)"
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
      }
      $done = (Test-Path $log) -and ((Get-Content $log -Tail 1) -match '^done ')
      Write-Output "  $(if ($done) { 'complete' } else { 'incomplete' })"
      # Keep the first completed run's baselines, so capintegrate can check
      # that the last run froze the identical machine. Without this the check
      # has nothing to compare against and passes vacuously.
      if ($done -and -not (Test-Path (Join-Path $step 'ram-baseline2.first'))) {
        foreach ($f in 'ram-baseline2', 'pf-baseline2', 'io-baseline2') {
          Copy-Item (Join-Path $step "$f.bin") (Join-Path $step "$f.first") -Force
        }
        Copy-Item (Join-Path $step 'io-track.bin') (Join-Path $step 'io-track.first') -Force
      }
    }
  }
}
Write-Output 'matrix reruns finished'
