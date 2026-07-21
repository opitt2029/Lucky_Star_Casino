# ============================================================
# 容量階梯（capacity ladder）：同一套服務，從低併發一路加壓到高併發，
# 每一階跑固定時間，收集「吞吐 / 延遲 / 卸載率 / 帳務違規」四條線。
#
# 為什麼要階梯而不是只跑一個併發數：
#   單一併發數只能回答「這個數字過不過」，回答不了「系統的容量到底在哪」。
#   階梯會畫出「吞吐上升 → 觸頂 → 延遲翻倍 → 開始卸載」的轉折點，那個轉折點
#   就是這台機器上的真實容量，也是簡報上最有價值的一張圖。
#
# 用法：
#   powershell -File tools/observability/run-capacity-ladder.ps1 `
#       -JMeter "C:\path\to\jmeter.bat" -Steps 25,50,100,150,300,600,1000
#
# 產出：
#   tests/performance/results/ladder-<timestamp>/ladder-summary.json + ladder-summary.md
#   （每一階原本的 results/<runid>/ 仍在，含 JMeter HTML dashboard）
# ============================================================
param(
    [Parameter(Mandatory = $true)][string]$JMeter,
    [int[]]$Steps = @(25, 50, 100, 150, 300, 600, 1000),
    [int]$DurationSeconds = 60,
    [int]$RampUpSeconds = 1,
    [int]$DeclaredCapacity = 150,
    [int]$Bet = 100,
    [int]$PacingMs = 1000,
    [int]$CooldownSeconds = 20,          # 每階之間讓系統回到基線，否則上一階的積壓污染下一階
    [int]$RefreshTokensEverySteps = 3    # JWT 只有 15 分鐘，階梯跑久了會整批 401
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$runnerPath = Join-Path $repoRoot "tests\performance\run-slot-load-test.ps1"
$resultsRoot = Join-Path $repoRoot "tests\performance\results"

$env:JVM_ARGS = "-Xss256k"                                    # 1,000 執行緒時省下數百 MB 堆疊
$env:HEAP = "-Xms512m -Xmx2g -XX:MaxMetaspaceSize=256m"       # 壓測機自己 OOM 會讓數據失真

$ladderId = Get-Date -Format "yyyyMMdd-HHmmss"
$ladderDir = Join-Path $resultsRoot "ladder-$ladderId"
New-Item -ItemType Directory -Path $ladderDir -Force | Out-Null

$ladderStartMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$rows = @()
$stepIndex = 0

foreach ($threads in $Steps) {
    $stepIndex++

    # JWT 效期 15 分鐘：每 N 階重發一次，避免中後段整批 401 把數據弄髒
    if ((($stepIndex - 1) % $RefreshTokensEverySteps) -eq 0) {
        Write-Host "[ladder] 重發 player token（第 $stepIndex 階前）"
        & node (Join-Path $repoRoot "tests\performance\refresh-player-tokens.mjs") | Out-Null
    }

    Write-Host "[ladder] === 第 $stepIndex/$($Steps.Count) 階：$threads 併發 ==="
    $startMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    & powershell -NoProfile -ExecutionPolicy Bypass -File $runnerPath `
        -JMeter $JMeter -Threads $threads -DurationSeconds $DurationSeconds `
        -RampUpSeconds $RampUpSeconds -DeclaredCapacity $DeclaredCapacity `
        -Bet $Bet -PacingMs $PacingMs 2>&1 | Out-Null
    $exitCode = $LASTEXITCODE

    $endMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    # 取這一階 runner 產出的資料夾（排除 ladder-* 自己）
    $runDir = Get-ChildItem -Path $resultsRoot -Directory |
        Where-Object { $_.Name -notlike "ladder-*" } |
        Sort-Object CreationTime -Descending | Select-Object -First 1

    # 直接讀 JTL 重算，不解析 markdown：markdown 是給人看的，格式一改就爆
    $stats = & node (Join-Path $scriptDir "summarize-jtl.mjs") (Join-Path $runDir.FullName "results.jtl") | ConvertFrom-Json

    $row = [ordered]@{
        step = $stepIndex
        threads = $threads
        runId = $runDir.Name
        startMs = $startMs
        endMs = $endMs
        gateExitCode = $exitCode
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
        idempotencyFailures = $stats.idempotencyFailures
        overdrawFailures = $stats.overdrawFailures
    }
    $rows += [pscustomobject]$row
    Write-Host ("[ladder] {0} 併發 → 吞吐 {1}/s、P99 {2} ms、卸載 {3}%、5xx {4}、帳務違規 {5}" -f `
        $threads, $stats.acceptedThroughputPerSec, $stats.p99, [math]::Round($stats.shedRatio * 100, 1), `
        $stats.errors5xx, ($stats.idempotencyFailures + $stats.overdrawFailures))

    if ($stepIndex -lt $Steps.Count) { Start-Sleep -Seconds $CooldownSeconds }
}

$ladderEndMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

$summary = [ordered]@{
    ladderId = $ladderId
    startMs = $ladderStartMs
    endMs = $ladderEndMs
    durationSecondsPerStep = $DurationSeconds
    declaredCapacity = $DeclaredCapacity
    bet = $Bet
    pacingMs = $PacingMs
    steps = $rows
}
$summary | ConvertTo-Json -Depth 6 | Out-File (Join-Path $ladderDir "ladder-summary.json") -Encoding utf8

# 順手產一張 markdown 表，貼進報告 / 簡報不用再手工排版
$md = @()
$md += "# 容量階梯結果（$ladderId）"
$md += ""
$md += "| 併發 | 樣本 | 被接受 | 吞吐(req/s) | P50(ms) | P95(ms) | P99(ms) | 卸載429 | 卸載率 | 5xx | 冪等違規 | 超扣違規 |"
$md += "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
foreach ($r in $rows) {
    $md += ("| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} | {8}% | {9} | {10} | {11} |" -f `
        $r.threads, $r.samples, $r.accepted, $r.acceptedThroughputPerSec, $r.p50, $r.p95, $r.p99, `
        $r.shed429, [math]::Round($r.shedRatio * 100, 1), $r.errors5xx, $r.idempotencyFailures, $r.overdrawFailures)
}
$md -join "`n" | Out-File (Join-Path $ladderDir "ladder-summary.md") -Encoding utf8

Write-Host "[ladder] 完成：$ladderDir"
Write-Host "[ladder] 時間窗（給 Grafana 截圖用）：from=$ladderStartMs to=$ladderEndMs"
