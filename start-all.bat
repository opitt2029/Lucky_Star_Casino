@echo off
REM ============================================================================
REM  Lucky Star Casino - one-click start (local dev)
REM  Mirrors DEPLOY.md / start-backend.ps1:
REM    1) Load root .env into this window (child windows inherit it)
REM    2) (optional) docker compose up -d  -> infrastructure
REM    3) Start member -> wallet -> game -> gateway, each in its own window
REM    4) (optional) start frontend (npm run dev) in another window
REM
REM  Usage:
REM    start-all.bat                 backend only (infra must be up already)
REM    start-all.bat infra           docker compose up -d, then backend
REM    start-all.bat frontend        backend + frontend
REM    start-all.bat infra frontend  everything
REM
REM  NOTE: keep this file ASCII-only. cmd.exe parses .bat in the legacy OEM
REM  codepage; non-ASCII (e.g. Chinese) bytes corrupt command parsing.
REM ============================================================================
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

REM ---- parse args ----
set "WITH_INFRA="
set "WITH_FRONTEND="
for %%a in (%*) do (
    if /i "%%a"=="infra"    set "WITH_INFRA=1"
    if /i "%%a"=="frontend" set "WITH_FRONTEND=1"
)

REM ---- check .env ----
if not exist "%ROOT%\.env" (
    echo [ERROR] .env not found. Create it first:  copy .env.example .env
    pause
    exit /b 1
)

REM ---- load .env into this window (eol=# skips comment lines) ----
set "COUNT=0"
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ROOT%\.env") do (
    set "KEY=%%a"
    set "VAL=%%b"
    for /f "tokens=* delims= " %%k in ("!KEY!") do set "KEY=%%k"
    if not "!KEY!"=="" (
        set "!KEY!=!VAL!"
        set /a COUNT+=1
    )
)
echo [OK] Loaded !COUNT! environment variables from .env
echo.

REM ---- (optional) infrastructure ----
if defined WITH_INFRA (
    echo [INFRA] docker compose up -d ...
    pushd "%ROOT%"
    docker compose up -d
    popd
    call :waitdb
    echo.
)

REM ---- start backends (gateway last) ----
call :startsvc member-service
call :startsvc wallet-service
call :startsvc game-service
call :startsvc gateway-service

REM ---- (optional) frontend ----
if defined WITH_FRONTEND (
    echo [FRONTEND] opening window: npm run dev
    start "frontend" cmd /k "cd /d %ROOT%\frontend && npm run dev"
)

echo.
echo ============================================================================
echo  Backends are starting; each service runs in its own window (title=service).
echo  Ports: member 8081 / wallet 8082 / game 8083 / gateway 8080
if not defined WITH_FRONTEND echo  Frontend: open a terminal -^>  cd frontend ^&^& npm run dev   (http://localhost:5173)
echo  Smoke test: register -^> login -^> balance -^> slot SPIN -^> baccarat bet.
echo  Stop: close each service window; infra via  docker compose down
echo ============================================================================
echo.
pause
exit /b 0

REM ---------------------------------------------------------------------------
REM  Wait for DB containers to report healthy before starting backends.
REM  Backends connect to DB at boot (Hibernate schema validate); MySQL/Postgres
REM  take 20-40s to become healthy on first boot. Starting too early crashes the
REM  service (this is the "login needs two tries" root cause). Poll the existing
REM  compose healthchecks, up to ~120s, then continue regardless.
:waitdb
echo [WAIT] waiting for databases to be healthy ...
set "TRIES=0"
:waitdb_loop
set "MYSQL_H="
set "PG_H="
for /f %%s in ('docker inspect --format "{{.State.Health.Status}}" lucky-star-mysql 2^>nul') do set "MYSQL_H=%%s"
for /f %%s in ('docker inspect --format "{{.State.Health.Status}}" lucky-star-postgres 2^>nul') do set "PG_H=%%s"
if "%MYSQL_H%"=="healthy" if "%PG_H%"=="healthy" (
    echo [OK] databases are healthy.
    exit /b 0
)
set /a TRIES+=1
if %TRIES% geq 40 (
    echo [WARN] timed out waiting for DB health; starting backends anyway.
    exit /b 0
)
REM ~3s between polls
ping 127.0.0.1 -n 4 >nul
goto :waitdb_loop

REM ---------------------------------------------------------------------------
:startsvc
echo [START] %~1 ...
start "%~1" cmd /k "cd /d %ROOT% && mvn -pl backend/%~1 spring-boot:run"
REM small delay before starting the next service
ping 127.0.0.1 -n 4 >nul
exit /b 0
