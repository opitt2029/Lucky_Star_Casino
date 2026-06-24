@echo off
title Lucky Star — Stopping backends
echo Stopping Lucky Star Casino backend services...
echo.

powershell -NoProfile -Command ^
  "$services = 'member-service','wallet-service','game-service','rank-service','admin-service','notification-service','gateway-service';" ^
  "foreach ($svc in $services) {" ^
  "  $p = Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq $svc } | Select-Object -First 1;" ^
  "  if ($p) { taskkill /pid $($p.Id) /t /f | Out-Null; Write-Host \"[OK] $svc stopped\" } else { Write-Host \"[--] $svc not running\" }" ^
  "}"

echo.
echo All done.
timeout /t 2 >nul
