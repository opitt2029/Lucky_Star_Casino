param([switch]$Infra)

$ports = [ordered]@{
    8080 = 'gateway'
    8081 = 'member'
    8082 = 'wallet'
    8083 = 'game'
    8084 = 'rank'
    8086 = 'admin'
    8087 = 'notification'
}

Write-Host '[STOP] stopping backend services...'

foreach ($entry in $ports.GetEnumerator()) {
    $port = $entry.Key
    $svc  = $entry.Value

    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) {
        Write-Host "  [--] $svc-service :$port not running"
        continue
    }

    # Walk up the parent tree to find the console window that hosts this service,
    # then kill it (closing the terminal window too).
    #   - start-all.bat opens each service in a cmd.exe window  (start "svc" cmd /k ...)
    #   - start-backend.ps1 (legacy) opened PowerShell windows  (Start-Process powershell)
    # Match either host. The first cmd/powershell ancestor IS the window process
    # (Maven's mvn.cmd launches java directly, it does not nest another cmd), so this
    # targets exactly the one window for this port and never the start-all launcher.
    # taskkill /t reaps the mvn/java children as well -> the port is always freed.
    $curPid  = $conn.OwningProcess
    $winPid  = $null
    $seen    = @{}
    while ($curPid -gt 4 -and -not $seen[$curPid]) {
        $seen[$curPid] = $true
        $proc = Get-Process -Id $curPid -ErrorAction SilentlyContinue
        if (-not $proc) { break }
        if ($proc.Name -match '^(powershell|pwsh|cmd)$') { $winPid = $curPid; break }
        $wmi = Get-CimInstance Win32_Process -Filter "ProcessId=$curPid" -ErrorAction SilentlyContinue
        if (-not $wmi) { break }
        $curPid = $wmi.ParentProcessId
    }

    if ($winPid) {
        taskkill /pid $winPid /t /f 2>&1 | Out-Null
        Write-Host "  [OK] $svc-service :$port stopped (window closed)"
    } else {
        taskkill /pid $conn.OwningProcess /t /f 2>&1 | Out-Null
        Write-Host "  [OK] $svc-service :$port stopped (process killed; window may remain)"
    }
}

if ($Infra) {
    Write-Host '[INFRA] docker compose down...'
    $root = Split-Path -Parent $MyInvocation.MyCommand.Path
    Push-Location $root
    docker compose down
    Pop-Location
}

Write-Host ''
Write-Host '[DONE] backend stopped.'
if (-not $Infra) {
    Write-Host '  Infra still running. To stop it too:  stop-all.bat infra'
}
