param(
    [string]$Psql = "psql",
    [string]$HostName = $env:POSTGRES_HOST,
    [int]$Port = $(if ($env:POSTGRES_PORT) { [int]$env:POSTGRES_PORT } else { 5433 }),
    [string]$Database = $env:POSTGRES_DB,
    [string]$User = $env:POSTGRES_USER,
    [string]$Password = $env:POSTGRES_PASSWORD,
    [string]$SqlPath = "",
    [string]$ResultDir = ""
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

if (-not (Get-Command $Psql -ErrorAction SilentlyContinue)) {
    throw "psql executable '$Psql' was not found. Install PostgreSQL client tools or pass -Psql with its full path."
}

$previousPassword = $env:PGPASSWORD
$env:PGPASSWORD = $Password
try {
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
