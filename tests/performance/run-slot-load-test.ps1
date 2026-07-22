param(
    [string]$JMeter = "jmeter",
    [string]$Protocol = "http",
    [string]$HostName = "localhost",
    [int]$Port = 8080,
    [string]$PlayersCsv = "",
    [int]$Threads = 1000,
    [int]$DurationSeconds = 60,
    [int]$RampUpSeconds = 1,
    [int]$Bet = 100,
    [int]$PacingMs = 1000,
    # Open-model target rate (iterations/sec) fed to PreciseThroughputTimer.
    # 0 = keep the historical coupling target_rps == Threads.
    # Decoupled so a high offered rate no longer forces an equally high thread
    # count on the load generator (5,000 threads would make JMeter itself the bottleneck).
    # NOTE: one iteration issues 2 spin samplers, so offered HTTP req/s ~= 2 * TargetRps.
    [int]$TargetRps = 0,
    # Skip JMeter's built-in HTML dashboard. At high offered rates a step produces
    # hundreds of thousands of samples and the report generator becomes the slowest
    # (and most memory-hungry) part of the run. Every number in the acceptance report
    # is recomputed from the raw .jtl, so the dashboard is an optional artifact.
    [switch]$NoHtmlReport,
    # D1-final（2026-07-18）：gate 與拓樸宣告綁定。Threads <= DeclaredCapacity 走驗收模式
    # （429=0 硬 gate）；Threads > DeclaredCapacity 走韌性模式（accepted 成功率 >= 95%，
    # 429/P99 只記趨勢）。模式由 analyze-jtl.mjs 依兩值自動判定，無須另傳參數。
    [int]$DeclaredCapacity = 150
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$testPlan = Join-Path $scriptDir "slot-1000-players.jmx"

if ([string]::IsNullOrWhiteSpace($PlayersCsv)) {
    $PlayersCsv = Join-Path $scriptDir "players.csv"
}
$PlayersCsv = (Resolve-Path $PlayersCsv).Path

$playerCount = (Get-Content -LiteralPath $PlayersCsv | Measure-Object -Line).Lines - 1
if ($playerCount -lt $Threads) {
    throw "players.csv requires at least $Threads data rows; found $playerCount."
}

$effectiveTargetRps = if ($TargetRps -gt 0) { $TargetRps } else { $Threads }

if (-not (Get-Command $JMeter -ErrorAction SilentlyContinue)) {
    throw "JMeter executable '$JMeter' was not found. Install Apache JMeter 5.6.3 or pass -JMeter with its full path."
}

$runId = Get-Date -Format "yyyyMMdd-HHmmss"
$resultDir = Join-Path $scriptDir "results\$runId"
$htmlDir = Join-Path $resultDir "html"
$jtl = Join-Path $resultDir "results.jtl"
$report = Join-Path $resultDir "acceptance-report.md"
New-Item -ItemType Directory -Path $resultDir | Out-Null

$jmeterArgs = @(
    "-n",
    "-t", $testPlan,
    "-Jprotocol=$Protocol",
    "-Jhost=$HostName",
    "-Jport=$Port",
    "-Jplayers_csv=$PlayersCsv",
    "-Jthreads=$Threads",
    "-Jtarget_rps=$effectiveTargetRps",
    "-Jduration_seconds=$DurationSeconds",
    "-Jramp_up_seconds=$RampUpSeconds",
    "-Jbet=$Bet",
    "-Jpacing_ms=$PacingMs",
    "-Jjmeter.save.saveservice.output_format=csv",
    "-Jjmeter.save.saveservice.print_field_names=true",
    "-Jjmeter.save.saveservice.assertion_results_failure_message=true",
    "-l", $jtl
)
if (-not $NoHtmlReport) {
    $jmeterArgs += @("-e", "-o", $htmlDir)
}

& $JMeter @jmeterArgs

if ($LASTEXITCODE -ne 0) {
    throw "JMeter exited with code $LASTEXITCODE."
}

$env:DECLARED_CAPACITY = $DeclaredCapacity
# Gate mode keys on the OFFERED load level, not on the size of the generator's
# thread pool. Historically the two were the same number; keep feeding the offered
# rate so acceptance/resilience selection stays comparable with earlier runs.
$env:THREADS = $effectiveTargetRps
node (Join-Path $scriptDir "analyze-jtl.mjs") $jtl $report
if ($LASTEXITCODE -ne 0) {
    throw "T-090 acceptance gates failed. See $report and $htmlDir."
}

Write-Host "T-090 acceptance gates passed."
Write-Host "Markdown report: $report"
Write-Host "JMeter HTML dashboard: $htmlDir"
