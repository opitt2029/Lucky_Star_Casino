<#
.SYNOPSIS
    One-click start for Lucky Star Casino backend services (local dev).

.DESCRIPTION
    Loads the root .env into this process, then opens one terminal window per
    backend service and starts it with Maven. Solves the most common pitfalls:
    forgetting to load .env into the shell, forgetting to start game-service,
    and juggling many terminals by hand.
    Start the infrastructure first with `docker compose up -d` (or pass -WithInfra).

.PARAMETER WithInfra
    Run `docker compose up -d` before starting the backend services.

.PARAMETER IncludeRank
    Also start rank-service (off by default; the frontend leaderboard still uses mock data).

.PARAMETER IncludeAdmin
    Also start admin-service (off by default; currently a skeleton with no business API).

.EXAMPLE
    .\start-backend.ps1
    Starts member, wallet, game, gateway (the minimum set needed to play the games).

.EXAMPLE
    .\start-backend.ps1 -WithInfra
    Brings up infrastructure first, then the backend services.
#>
param(
    [switch]$WithInfra,
    [switch]$IncludeRank,
    [switch]$IncludeAdmin
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$envFile = Join-Path $root '.env'

if (-not (Test-Path $envFile)) {
    Write-Error ".env not found. Create it first:  Copy-Item .env.example .env"
    return
}

# Parse .env and set each KEY=VALUE into THIS process's environment.
# Child windows started by Start-Process inherit these, so they don't reload .env.
$count = 0
Get-Content $envFile | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
    $name, $value = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), 'Process')
    $count++
}
Write-Host "Loaded $count environment variables from .env" -ForegroundColor Green

if ($WithInfra) {
    Write-Host "Starting infrastructure (docker compose up -d)..." -ForegroundColor Cyan
    docker compose up -d
    Write-Host "Wait until infra is healthy before backends connect; check with: docker compose ps" -ForegroundColor Yellow
}

# Order: member -> wallet -> game -> (rank) -> (admin) -> gateway (gateway last)
$services = @('member-service', 'wallet-service', 'game-service')
if ($IncludeRank)  { $services += 'rank-service' }
if ($IncludeAdmin) { $services += 'admin-service' }
$services += 'gateway-service'

foreach ($svc in $services) {
    Write-Host "Starting $svc ..." -ForegroundColor Green
    $cmd = "Set-Location '$root'; `$Host.UI.RawUI.WindowTitle = '$svc'; mvn -pl backend/$svc spring-boot:run"
    Start-Process powershell -ArgumentList '-NoExit', '-Command', $cmd
    Start-Sleep -Seconds 3
}

Write-Host ""
Write-Host "Backends are starting; each service logs in its own window (titled with the service name)." -ForegroundColor Cyan
Write-Host "Frontend: open another terminal ->  cd frontend ; npm run dev   (http://localhost:5173)" -ForegroundColor Cyan
Write-Host ""
Write-Host "Smoke test: register -> login -> see balance -> slot SPIN -> baccarat bet one side & lose -> balance drops." -ForegroundColor Cyan
Write-Host "Stop: close each service window; infra via 'docker compose down'." -ForegroundColor DarkGray
