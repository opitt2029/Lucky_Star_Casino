@echo off
title Lucky Star — Stopping backends
echo Stopping Lucky Star Casino backend services...
echo.

for %%s in (member-service wallet-service game-service rank-service admin-service notification-service gateway-service) do (
    taskkill /fi "WINDOWTITLE eq %%s" /t /f >nul 2>&1
    if errorlevel 1 (
        echo [--] %%s  not running
    ) else (
        echo [OK] %%s  stopped
    )
)

echo.
echo All done.
timeout /t 2 >nul
