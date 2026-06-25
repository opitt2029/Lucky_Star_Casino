@echo off
REM ============================================================================
REM  Lucky Star Casino - one-click stop (local dev)
REM  Stops backend services started by start-all.bat / start-backend.ps1.
REM
REM  Usage:
REM    stop-all.bat            stop backend services only
REM    stop-all.bat infra      stop backend + docker compose down
REM
REM  NOTE: keep this file ASCII-only (cmd.exe parses .bat in the legacy OEM
REM  codepage; non-ASCII bytes corrupt command parsing).
REM  Logic lives in stop-all.ps1 to avoid cmd ^ escaping issues.
REM ============================================================================

if /i "%1"=="infra" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-all.ps1" -Infra
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-all.ps1"
)

echo.
pause
exit /b 0
