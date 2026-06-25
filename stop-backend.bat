@echo off
title Lucky Star - Stopping backends
echo Stopping Lucky Star Casino backend services...
echo.

REM Delegate to stop-all.ps1 -- the single source of truth for the stop / close-window
REM logic. It walks the parent tree to close the cmd/powershell window that HOSTS each
REM service (start-all.bat opens cmd windows), not just the java process; otherwise the
REM port is freed but the terminal window stays open. Keeping the logic in one .ps1 also
REM avoids cmd ^ / \" escaping hell.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-all.ps1"

echo.
echo Done.
REM brief pause so the window is readable; ping (not timeout) works even when
REM stdin is redirected (timeout aborts with "Input redirection is not supported").
ping -n 3 127.0.0.1 >nul
