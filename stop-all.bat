@echo off
REM ============================================================================
REM  Lucky Star Casino - one-click stop (local dev)
REM  Stops the backend services started by start-all.bat (ports 8080-8083),
REM  and optionally brings down the Docker infrastructure.
REM
REM  Usage:
REM    stop-all.bat            stop backend services only
REM    stop-all.bat infra      stop backend + docker compose down
REM
REM  NOTE: keep this file ASCII-only (cmd.exe parses .bat in the legacy OEM
REM  codepage; non-ASCII bytes corrupt command parsing).
REM ============================================================================
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "WITH_INFRA="
for %%a in (%*) do (
    if /i "%%a"=="infra" set "WITH_INFRA=1"
)

echo [STOP] stopping backend services (ports 8080/8081/8082/8083/8084/8086/8087) ...
powershell -NoProfile -Command ^
  "$ports = @{8080='gateway';8081='member';8082='wallet';8083='game';8084='rank';8086='admin';8087='notification'};" ^
  "foreach ($port in ($ports.Keys | Sort-Object)) {" ^
  "  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -EA SilentlyContinue | Select-Object -First 1;" ^
  "  if (!$conn) { Write-Host \"  [--] $($ports[$port])-service :$port not running\"; continue };" ^
  "  $pid = $conn.OwningProcess; $psPid = $null; $seen = @{};" ^
  "  while ($pid -gt 4 -and !$seen[$pid]) {" ^
  "    $seen[$pid] = $true;" ^
  "    $proc = Get-Process -Id $pid -EA SilentlyContinue;" ^
  "    if (!$proc) { break };" ^
  "    if ($proc.Name -match 'powershell') { $psPid = $pid; break };" ^
  "    $pid = (Get-CimInstance Win32_Process -Filter \"ProcessId=$pid\" -EA SilentlyContinue).ParentProcessId" ^
  "  };" ^
  "  if ($psPid) { Stop-Process -Id $psPid -Force -EA SilentlyContinue; Write-Host \"  [OK] $($ports[$port])-service :$port stopped (window closed)\" }" ^
  "  else { taskkill /pid $conn.OwningProcess /t /f 2>&1 | Out-Null; Write-Host \"  [OK] $($ports[$port])-service :$port stopped\" }" ^
  "}"

if defined WITH_INFRA (
    echo [INFRA] docker compose down ...
    pushd "%ROOT%"
    docker compose down
    popd
)

echo [DONE] backend stopped.
if not defined WITH_INFRA echo  Infra still running. To stop it too:  stop-all.bat infra   (or docker compose down)
echo.
pause
exit /b 0
