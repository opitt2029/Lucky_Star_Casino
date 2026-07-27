param(
    [string]$Psql = "psql",
    [string]$HostName = $env:POSTGRES_HOST,
    [int]$Port = $(if ($env:POSTGRES_PORT) { [int]$env:POSTGRES_PORT } else { 5433 }),
    [string]$Database = $env:POSTGRES_DB,
    [string]$User = $env:POSTGRES_USER,
    [string]$Password = $env:POSTGRES_PASSWORD,
    [string]$SqlPath = "",
    [string]$ResultDir = "",
    # 本機沒有 psql 時，改用這個容器裡的 psql 跑同一份 SQL（容器內必定有 client）
    [string]$PostgresContainer = "lucky-star-postgres"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if ([string]::IsNullOrWhiteSpace($HostName)) { $HostName = "localhost" }
if ([string]::IsNullOrWhiteSpace($Database)) { $Database = "lucky_star_casino" }
if ([string]::IsNullOrWhiteSpace($User)) { $User = "lucky_user" }
if ([string]::IsNullOrWhiteSpace($Password)) { $Password = "lucky_password" }
if ([string]::IsNullOrWhiteSpace($SqlPath)) {
    $SqlPath = Join-Path $scriptDir "accounting-reconciliation.sql"
}
if ([string]::IsNullOrWhiteSpace($ResultDir)) {
    $runId = Get-Date -Format "yyyyMMdd-HHmmss"
    $ResultDir = Join-Path $scriptDir "results\accounting-$runId"
}

$SqlPath = (Resolve-Path $SqlPath).Path
New-Item -ItemType Directory -Path $ResultDir -Force | Out-Null

$csvPath = Join-Path $ResultDir "accounting-reconciliation.csv"
$reportPath = Join-Path $ResultDir "accounting-reconciliation-report.md"

# psql（PostgreSQL client tools）不是本專案的必要相依，開發機常常沒裝。既然 Postgres 本來就
# 跑在容器裡，容器內一定有 psql——沒有本機 psql 時自動改用 docker exec 跑同一份 SQL。
# 2026-07-22 實跑就是卡在這裡（run-accounting-reconciliation.ps1 直接 throw），只好手動下指令。
$useDocker = -not (Get-Command $Psql -ErrorAction SilentlyContinue)
if ($useDocker) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "psql executable '$Psql' was not found, and docker is unavailable as a fallback. Install PostgreSQL client tools or pass -Psql with its full path."
    }
    Write-Host "[T-091] 本機找不到 psql，改用 docker exec $PostgresContainer 跑對帳 SQL。"
}

$previousPassword = $env:PGPASSWORD
$env:PGPASSWORD = $Password
try {
    if ($useDocker) {
        # 刻意用 `docker cp` + `-f` 餵檔，不用 `Get-Content | docker exec -i psql` 這種 pipe 餵法：
        # pipe 會經過 PowerShell 的編碼轉換，實測會讓 SQL 裡的單行註解吃掉後面的換行，
        # 把 WHERE 的後續條件整段註解掉 → 檢查靜默放寬、卻不會有任何錯誤訊息。
        $containerSqlPath = "/tmp/accounting-reconciliation.sql"
        & docker cp $SqlPath "${PostgresContainer}:$containerSqlPath" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "docker cp 失敗（容器 '$PostgresContainer' 是否存在？）" }

        $psqlOutput = & docker exec -e "PGPASSWORD=$Password" -e "PGCLIENTENCODING=UTF8" $PostgresContainer `
            psql -X -v "ON_ERROR_STOP=1" --csv -P "footer=off" -U $User -d $Database -f $containerSqlPath
        if ($LASTEXITCODE -ne 0) { throw "docker exec psql exited with code $LASTEXITCODE." }

        & docker exec $PostgresContainer rm -f $containerSqlPath | Out-Null
    }
    else {
        $psqlOutput = & $Psql `
            -X `
            -v "ON_ERROR_STOP=1" `
            --csv `
            -P "footer=off" `
            -h $HostName `
            -p $Port `
            -U $User `
            -d $Database `
            -f $SqlPath

        if ($LASTEXITCODE -ne 0) {
            throw "psql exited with code $LASTEXITCODE."
        }
    }
} finally {
    $env:PGPASSWORD = $previousPassword
}

$csvText = ($psqlOutput | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join [Environment]::NewLine
if ([string]::IsNullOrWhiteSpace($csvText)) {
    throw "Accounting reconciliation SQL returned no rows."
}

Set-Content -LiteralPath $csvPath -Value $csvText -Encoding UTF8
$rows = $csvText | ConvertFrom-Csv
if ($rows.Count -eq 0) {
    throw "Accounting reconciliation SQL returned no check rows."
}

$failedRows = @($rows | Where-Object { [int64]$_.violation_count -ne 0 })
$result = if ($failedRows.Count -eq 0) { "PASS" } else { "FAIL" }
$generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$tableRows = $rows | ForEach-Object {
    $status = if ([int64]$_.violation_count -eq 0) { "PASS" } else { "FAIL" }
    "| $($_.check_name) | $($_.violation_count) | $status | $($_.description) |"
}

$report = @"
# T-091 Accounting Reconciliation Report

- Generated: $generatedAt
- Database: $HostName`:$Port/$Database
- SQL: $SqlPath
- Result: **$result**

| Check | Violations | Result | Description |
|---|---:|---|---|
$($tableRows -join [Environment]::NewLine)
"@

Set-Content -LiteralPath $reportPath -Value $report -Encoding UTF8
Write-Host $report
Write-Host "CSV report: $csvPath"
Write-Host "Markdown report: $reportPath"

if ($failedRows.Count -gt 0) {
    throw "T-091 accounting reconciliation failed: $($failedRows.Count) check(s) reported violations."
}
