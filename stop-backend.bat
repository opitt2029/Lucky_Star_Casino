@echo off
title Lucky Star - Stopping backends
echo Stopping Lucky Star Casino backend services...
echo.

powershell -NoProfile -Command ^
  "$ports = [ordered]@{8080='gateway';8081='member';8082='wallet';8083='game';8084='rank';8086='admin';8087='notification'};" ^
  "foreach ($entry in $ports.GetEnumerator()) {" ^
  "  $c = Get-NetTCPConnection -LocalPort $entry.Key -State Listen -EA SilentlyContinue | Select -First 1;" ^
  "  if ($c) { taskkill /pid $($c.OwningProcess) /t /f 2>&1 | Out-Null; Write-Host \"[OK] $($entry.Value)-service :$($entry.Key) stopped\" }" ^
  "  else { Write-Host \"[--] $($entry.Value)-service :$($entry.Key) not running\" }" ^
  "}"

echo.
echo Done.
timeout /t 2 >nul
