# ============================================================
# 捕魚機容量階梯（capacity ladder）：同一套服務，從低併發一路加壓到高併發。
# 與 run-capacity-ladder.ps1（老虎機）平行；因捕魚的施壓計畫（buy-in 開場 + shots
# 批次射擊）與 slot 的 runner 參數不同，這裡把 JMeter 呼叫「內聯」在階梯迴圈裡，
# 刻意不重用 slot 的 run-slot-load-test.ps1（避免動到已驗收的 slot 路徑）。
#
# 主負載端點：POST /api/v1/game/fishing/{sessionId}/shots（單發批次、1 秒 pacing，
#   永不觸射速上限）。每個虛擬玩家先 OnceOnly buy-in 開一次場。
#
# 用法：
#   & tools/observability/run-fishing-ladder.ps1 `
#       -JMeter "C:\path\to\jmeter.bat" -Steps @(25,50,100,150,300)
#   （陣列參數務必用 & 直接呼叫，不可經 powershell -File 傳，見 AGENTS.md 雷區 27）
#
# 產出：
#   tests/performance/results/fishing-ladder-<timestamp>/ladder-summary.json + .md
#   （每一階原始 results/<runid>/ 仍在，含 JMeter HTML dashboard 與 results.jtl）
# ============================================================
param(
    [Parameter(Mandatory = $true)][string]$JMeter,
    [int[]]$Steps = @(25, 50, 100, 150, 300, 600, 1000),
    [int]$DurationSeconds = 60,
    [int]$RampUpSeconds = 1,
    [int]$BuyIn = 200000,
    [int]$CannonLevel = 1,
    [int]$BetPerShot = 10,
    [int]$PacingMs = 1000,
    [int]$CooldownSeconds = 20,          # 每階之間讓系統回到基線，否則上一階的積壓污染下一階
    [int]$RefreshTokensEverySteps = 3    # JWT 只有 15 分鐘，階梯跑久了會整批 401
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$testPlan = Join-Path $repoRoot "tests\performance\fishing-1000-players.jmx"
$playersCsv = Join-Path $repoRoot "tests\performance\players.csv"
$resultsRoot = Join-Path $repoRoot "tests\performance\results"

if (-not (Get-Command $JMeter -ErrorAction SilentlyContinue) -and -not (Test-Path $JMeter)) {
    throw "JMeter executable '$JMeter' was not found. Install Apache JMeter 5.6.3 or pass -JMeter with its full path."
}
$playersCsv = (Resolve-Path $playersCsv).Path
$playerCount = (Get-Content -LiteralPath $playersCsv | Measure-Object -Line).Lines - 1

$env:JVM_ARGS = "-Xss256k"                                    # 1,000 執行緒時省下數百 MB 堆疊
$env:HEAP = "-Xms512m -Xmx2g -XX:MaxMetaspaceSize=256m"       # 壓測機自己 OOM 會讓數據失真

$ladderId = Get-Date -Format "yyyyMMdd-HHmmss"
$ladderDir = Join-Path $resultsRoot "fishing-ladder-$ladderId"
New-Item -ItemType Directory -Path $ladderDir -Force | Out-Null

$ladderStartMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$rows = @()
$stepIndex = 0

foreach ($threads in $Steps) {
    $stepIndex++

    if ($playerCount -lt $threads) {
        Write-Host "[fishing-ladder] 跳過 $threads 併發：players.csv 只有 $playerCount 列（< $threads）"
        continue
    }

    # JWT 效期 15 分鐘：每 N 階重發一次，避免中後段整批 401 把數據弄髒
    if ((($stepIndex - 1) % $RefreshTokensEverySteps) -eq 0) {
        Write-Host "[fishing-ladder] 重發 player token（第 $stepIndex 階前）"
        & node (Join-Path $repoRoot "tests\performance\refresh-player-tokens.mjs") | Out-Null
    }

    Write-Host "[fishing-ladder] === 第 $stepIndex/$($Steps.Count) 階：$threads 併發 ==="
    $startMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    $runId = Get-Date -Format "yyyyMMdd-HHmmss"
    $resultDir = Join-Path $resultsRoot $runId
    $htmlDir = Join-Path $resultDir "html"
    $jtl = Join-Path $resultDir "results.jtl"
    New-Item -ItemType Directory -Path $resultDir -Force | Out-Null

    & $JMeter `
        -n `
        -t $testPlan `
        "-Jhost=localhost" `
        "-Jport=8080" `
        "-Jplayers_csv=$playersCsv" `
        "-Jthreads=$threads" `
        "-Jduration_seconds=$DurationSeconds" `
        "-Jramp_up_seconds=$RampUpSeconds" `
        "-Jbuy_in=$BuyIn" `
        "-Jcannon_level=$CannonLevel" `
        "-Jbet_per_shot=$BetPerShot" `
        "-Jpacing_ms=$PacingMs" `
        "-Jjmeter.save.saveservice.output_format=csv" `
        "-Jjmeter.save.saveservice.print_field_names=true" `
        "-Jjmeter.save.saveservice.assertion_results_failure_message=true" `
        -l $jtl `
        -e `
        -o $htmlDir 2>&1 | Out-Null
    $exitCode = $LASTEXITCODE

    $endMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    # 直接讀 JTL 重算（不解析 markdown：格式一改就爆）
    $stats = & node (Join-Path $scriptDir "summarize-jtl.mjs") $jtl | ConvertFrom-Json

    $row = [ordered]@{
        step = $stepIndex
        threads = $threads
        runId = $runId
        startMs = $startMs
        endMs = $endMs
        jmeterExitCode = $exitCode
        samples = $stats.samples
        accepted = $stats.accepted
        shed429 = $stats.shed429
        shedRatio = $stats.shedRatio
        throughputPerSec = $stats.throughputPerSec
        acceptedThroughputPerSec = $stats.acceptedThroughputPerSec
        p50 = $stats.p50
        p95 = $stats.p95
        p99 = $stats.p99
        max = $stats.max
        errors5xx = $stats.errors5xx
        failures = $stats.failures
    }
    $rows += [pscustomobject]$row
    Write-Host ("[fishing-ladder] {0} 併發 → 吞吐 {1}/s、P99 {2} ms、卸載 {3}%、5xx {4}、失敗 {5}" -f `
        $threads, $stats.acceptedThroughputPerSec, $stats.p99, [math]::Round($stats.shedRatio * 100, 1), `
        $stats.errors5xx, $stats.failures)

    if ($stepIndex -lt $Steps.Count) { Start-Sleep -Seconds $CooldownSeconds }
}

$ladderEndMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

$summary = [ordered]@{
    ladderId = $ladderId
    game = "fishing"
    startMs = $ladderStartMs
    endMs = $ladderEndMs
    durationSecondsPerStep = $DurationSeconds
    buyIn = $BuyIn
    cannonLevel = $CannonLevel
    betPerShot = $BetPerShot
    pacingMs = $PacingMs
    steps = $rows
}
$summary | ConvertTo-Json -Depth 6 | Out-File (Join-Path $ladderDir "ladder-summary.json") -Encoding utf8

# 順手產一張 markdown 表，貼進報告 / 簡報不用再手工排版
$md = @()
$md += "# 捕魚機容量階梯結果（$ladderId）"
$md += ""
$md += "| 併發 | 樣本 | 被接受 | 吞吐(req/s) | P50(ms) | P95(ms) | P99(ms) | 卸載429 | 卸載率 | 5xx | 失敗 |"
$md += "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
foreach ($r in $rows) {
    $md += ("| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} | {8}% | {9} | {10} |" -f `
        $r.threads, $r.samples, $r.accepted, $r.acceptedThroughputPerSec, $r.p50, $r.p95, $r.p99, `
        $r.shed429, [math]::Round($r.shedRatio * 100, 1), $r.errors5xx, $r.failures)
}
$md -join "`n" | Out-File (Join-Path $ladderDir "ladder-summary.md") -Encoding utf8

Write-Host "[fishing-ladder] 完成：$ladderDir"
Write-Host "[fishing-ladder] 時間窗（給 Grafana 截圖用）：from=$ladderStartMs to=$ladderEndMs"
