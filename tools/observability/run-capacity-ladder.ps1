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
    [int]$DurationSeconds = 180,          # P2：每階 ≥180s，含 JIT/池爬升雜訊後仍留足夠穩態樣本算 percentile
    [int]$WarmupSeconds = 30,             # P2：算 percentile 前丟掉每階前 N 秒暖機窗（傳給 summarize-jtl.mjs）
    [int]$RampUpSeconds = 1,              # open-model 下維持短 ramp：讓執行緒盡快就緒，避免 PreciseThroughputTimer 早期缺工被迫降速
    [int]$DeclaredCapacity = 150,
    [int]$Bet = 100,
    [int]$PacingMs = 1000,
    [int]$CooldownSeconds = 20,          # P4：改當「讀不到 outbox/lag 指標時的退回固定冷卻」；正常走 Wait-ForQuiescence poll 排空
    [int]$MaxQuiesceSeconds = 90,        # P4：poll 排空的逾時上限，逾時就繼續（絕不卡死階梯）
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

# T-090 P0：階梯開跑前打一次環境快照（git SHA / 各服務 HikariCP 上限 / docker stats），
# 寫進 ladder-summary.json。#240 vs #242 同條件吞吐差 4 倍卻無法重現，就是因為沒記這些。
. (Join-Path $scriptDir "capture-environment.ps1")
. (Join-Path $scriptDir "wait-for-quiescence.ps1")   # P4：階間排空等待
. (Join-Path $scriptDir "sample-host-java-cpu.ps1")  # P3：量施壓機 JMeter 自身 CPU
Write-Host "[ladder] 擷取環境快照（P0：git SHA / 各服務 HikariCP 上限 / docker stats）..."
$environment = Get-CapacityEnvironmentSnapshot -RepoRoot $repoRoot

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

    $cpuSampler = Start-HostJavaCpuSampler   # P3：step 進行中量 host java（JMeter）CPU
    & powershell -NoProfile -ExecutionPolicy Bypass -File $runnerPath `
        -JMeter $JMeter -Threads $threads -DurationSeconds $DurationSeconds `
        -RampUpSeconds $RampUpSeconds -DeclaredCapacity $DeclaredCapacity `
        -Bet $Bet -PacingMs $PacingMs 2>&1 | Out-Null
    $exitCode = $LASTEXITCODE
    $jmeterCpuPct = Stop-HostJavaCpuSampler -Job $cpuSampler   # P3：>25% 代表施壓機在搶 SUT 資源

    $endMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    # 取這一階 runner 產出的資料夾（排除 ladder-* 自己）
    $runDir = Get-ChildItem -Path $resultsRoot -Directory |
        Where-Object { $_.Name -notlike "ladder-*" } |
        Sort-Object CreationTime -Descending | Select-Object -First 1

    # 直接讀 JTL 重算，不解析 markdown：markdown 是給人看的，格式一改就爆
    $stats = & node (Join-Path $scriptDir "summarize-jtl.mjs") (Join-Path $runDir.FullName "results.jtl") $WarmupSeconds | ConvertFrom-Json

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
        jmeterHostJavaCpuPct = $jmeterCpuPct        # P3：施壓機自身 CPU%（近似 JMeter；>25% 該階數字打折）
    }
    $rows += [pscustomobject]$row
    Write-Host ("[ladder] {0} 併發 → 吞吐 {1}/s、P99 {2} ms、卸載 {3}%、5xx {4}、帳務違規 {5}、JMeter CPU {6}%" -f `
        $threads, $stats.acceptedThroughputPerSec, $stats.p99, [math]::Round($stats.shedRatio * 100, 1), `
        $stats.errors5xx, ($stats.idempotencyFailures + $stats.overdrawFailures), `
        ($(if ($null -eq $jmeterCpuPct) { 'n/a' } else { $jmeterCpuPct })))

    # P4：不再死等固定秒數，改 poll 到 backlog 排空（outbox PENDING==0 且 consumer lag==0）才進下一階
    if ($stepIndex -lt $Steps.Count) {
        Wait-ForQuiescence -FallbackCooldownSeconds $CooldownSeconds -MaxWaitSeconds $MaxQuiesceSeconds
    }
}

$ladderEndMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

$summary = [ordered]@{
    ladderId = $ladderId
    startMs = $ladderStartMs
    endMs = $ladderEndMs
    durationSecondsPerStep = $DurationSeconds
    warmupSeconds = $WarmupSeconds
    declaredCapacity = $DeclaredCapacity
    bet = $Bet
    pacingMs = $PacingMs
    # T-090 P1：施壓模型已從 closed-loop（ConstantTimer，等回應完再等固定 1 秒）改為 open-model
    # （PreciseThroughputTimer，依牆鐘排程發送、不管前一發回沒回）。故 pacingMs 已不再控制節奏，
    # 保留只為記錄；真正的目標速率 = target_rps = 該階 threads（spins/sec）。open-model 下慢請求
    # 會真的堆積，P99 不再被 coordinated omission 系統性低估。
    loadModel = "open-model (PreciseThroughputTimer, target_rps = threads spins/sec)"
    environment = $environment
    steps = $rows
}
$summary | ConvertTo-Json -Depth 6 | Out-File (Join-Path $ladderDir "ladder-summary.json") -Encoding utf8

# 順手產一張 markdown 表，貼進報告 / 簡報不用再手工排版
$md = @()
$md += "# 容量階梯結果（$ladderId）"
$md += ""
$md += "> 施壓模型：**open-model**（PreciseThroughputTimer，target_rps = 該階 threads spins/sec）。慢請求會真的堆積，P99 為誠實值（非 closed-loop 的樂觀值）。"
$md += "> 統計口徑：percentile 只用**穩態窗**（已切掉每階前 $WarmupSeconds 秒暖機；每階 $DurationSeconds 秒，P2）。"
$md += "> 施壓機隔離：各階 ``jmeterHostJavaCpuPct``（見 ladder-summary.json）為 host java（近似 JMeter）平均 CPU%；>25% 代表施壓機在搶 SUT 資源、該階數字打折（P3）。docker stats 快照見下方環境段。"
$md += ""
$md += "| 併發 | 樣本 | 被接受 | 吞吐(req/s) | P50(ms) | P95(ms) | P99(ms) | 卸載429 | 卸載率 | 5xx | 冪等違規 | 超扣違規 |"
$md += "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
foreach ($r in $rows) {
    $md += ("| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} | {8}% | {9} | {10} | {11} |" -f `
        $r.threads, $r.samples, $r.accepted, $r.acceptedThroughputPerSec, $r.p50, $r.p95, $r.p99, `
        $r.shed429, [math]::Round($r.shedRatio * 100, 1), $r.errors5xx, $r.idempotencyFailures, $r.overdrawFailures)
}

# T-090 P5：講清楚「冪等違規/超扣違規」兩欄的語意，別被讀成「帳務已證明正確」
$md += ""
$md += "## 帳務違規口徑（P5：別把 JMeter 斷言當成對帳）"
$md += ""
$md += "- 表中「冪等違規 / 超扣違規」= **JMeter in-flight 斷言**（每筆回應是否帶負餘額 / 冪等錯誤訊息）。只抓「回應當下」的異常，**抓不到 DB 層重複入帳或跨請求的帳不平**。"
$md += "- **真正權威 = T-091 SQL 對帳**（``tests/performance/accounting-reconciliation.sql``，跑法見 ``run-accounting-reconciliation.ps1``）：直接比對 ``wallet_transactions`` 帳本。壓測後務必跑一次，別把上面兩欄的 0 讀成「帳務已證明正確」。"

# T-090 P0：把環境快照也印進 markdown，報告一眼就能看到「這一輪是在什麼環境下跑的」
$md += ""
$md += "## 環境快照（P0：確保可重現）"
$md += ""
$md += "- git：$($environment.gitBranch) @ $($environment.gitSha)"
$md += "- 擷取時間(UTC)：$($environment.capturedAtUtc)"
$md += ""
$md += "| 服務 | port | 連線池上限(總) | 池名 |"
$md += "|---|---:|---:|---|"
foreach ($svc in $environment.hikaricpConnectionsMax.Keys) {
    $p = $environment.hikaricpConnectionsMax[$svc]
    $poolNames = if ($p.poolNames) { ($p.poolNames -join ', ') } else { '-' }
    $maxc = if ($null -ne $p.maxConnectionsTotal) { $p.maxConnectionsTotal } else { 'n/a（服務未起 / actuator 未開）' }
    $md += ("| {0} | {1} | {2} | {3} |" -f $svc, $p.port, $maxc, $poolNames)
}
if ($environment.dockerStats) {
    $md += ""
    $md += "docker stats（同機資源競爭；JMeter/prac-* 容器偷 SUT 資源會讓數字失真）："
    $md += '```'
    $md += $environment.dockerStats
    $md += '```'
}
$md -join "`n" | Out-File (Join-Path $ladderDir "ladder-summary.md") -Encoding utf8

Write-Host "[ladder] 完成：$ladderDir"
Write-Host "[ladder] 時間窗（給 Grafana 截圖用）：from=$ladderStartMs to=$ladderEndMs"
