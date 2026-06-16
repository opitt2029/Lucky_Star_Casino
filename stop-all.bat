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

echo [STOP] killing processes listening on 8080/8081/8082/8083 ...
powershell -NoProfile -Command "foreach($p in 8080,8081,8082,8083){ $ids = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach($id in $ids){ try{ Stop-Process -Id $id -Force -ErrorAction Stop; Write-Host ('  stopped PID ' + $id + ' (port ' + $p + ')') }catch{} } }"

REM best-effort: close leftover service windows by title (and their child mvn/java)
for %%s in (member-service wallet-service game-service gateway-service) do taskkill /FI "WINDOWTITLE eq %%s" /T /F >nul 2>&1

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
