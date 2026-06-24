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

    # Walk up parent tree to find the PowerShell window; killing it closes the terminal
    $curPid = $conn.OwningProcess
    $psPid  = $null
    $seen   = @{}
    while ($curPid -gt 4 -and -not $seen[$curPid]) {
        $seen[$curPid] = $true
        $proc = Get-Process -Id $curPid -ErrorAction SilentlyContinue
        if (-not $proc) { break }
        if ($proc.Name -match 'powershell') { $psPid = $curPid; break }
        $wmi = Get-CimInstance Win32_Process -Filter "ProcessId=$curPid" -ErrorAction SilentlyContinue
        if (-not $wmi) { break }
        $curPid = $wmi.ParentProcessId
    }

    if ($psPid) {
        Stop-Process -Id $psPid -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] $svc-service :$port stopped (window closed)"
    } else {
        taskkill /pid $conn.OwningProcess /t /f 2>&1 | Out-Null
        Write-Host "  [OK] $svc-service :$port stopped"
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
