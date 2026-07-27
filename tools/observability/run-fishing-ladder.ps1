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
    [int]$DurationSeconds = 180,          # P2：每階 ≥180s，含 JIT/池爬升雜訊後仍留足夠穩態樣本算 percentile
    [int]$WarmupSeconds = 30,             # P2：算 percentile 前丟掉每階前 N 秒暖機窗（傳給 summarize-jtl.mjs）
    [int]$RampUpSeconds = 1,              # open-model 下維持短 ramp：讓執行緒盡快就緒，避免 PreciseThroughputTimer 早期缺工被迫降速
    [int]$BuyIn = 200000,
    [int]$CannonLevel = 1,
    [int]$BetPerShot = 10,
    [int]$PacingMs = 1000,
    [int]$CooldownSeconds = 20,          # P4：改當「讀不到 outbox/lag 指標時的退回固定冷卻」；正常走 Wait-ForQuiescence poll 排空
    [int]$MaxQuiesceSeconds = 90,        # P4：poll 排空的逾時上限，逾時就繼續（絕不卡死階梯）
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

# T-090 P0：階梯開跑前打一次環境快照（git SHA / 各服務 HikariCP 上限 / docker stats），
# 寫進 ladder-summary.json。沒記環境＝不可重現＝數字不能引用（見 #240 vs #242 的矛盾）。
. (Join-Path $scriptDir "capture-environment.ps1")
. (Join-Path $scriptDir "wait-for-quiescence.ps1")   # P4：階間排空等待
. (Join-Path $scriptDir "sample-host-java-cpu.ps1")  # P3：量施壓機 JMeter 自身 CPU
Write-Host "[fishing-ladder] 擷取環境快照（P0：git SHA / 各服務 HikariCP 上限 / docker stats）..."
$environment = Get-CapacityEnvironmentSnapshot -RepoRoot $repoRoot

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

    $cpuSampler = Start-HostJavaCpuSampler   # P3：step 進行中量 host java（JMeter）CPU
    & $JMeter `
        -n `
        -t $testPlan `
        "-Jhost=localhost" `
        "-Jport=8080" `
        "-Jplayers_csv=$playersCsv" `
        "-Jthreads=$threads" `
        "-Jtarget_rps=$threads" `
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
    $jmeterCpuPct = Stop-HostJavaCpuSampler -Job $cpuSampler   # P3：>25% 代表施壓機在搶 SUT 資源

    $endMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    # 直接讀 JTL 重算（不解析 markdown：格式一改就爆）
    $stats = & node (Join-Path $scriptDir "summarize-jtl.mjs") $jtl $WarmupSeconds | ConvertFrom-Json

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
        jmeterHostJavaCpuPct = $jmeterCpuPct        # P3：施壓機自身 CPU%（近似 JMeter；>25% 該階數字打折）
    }
    $rows += [pscustomobject]$row
    Write-Host ("[fishing-ladder] {0} 併發 → 吞吐 {1}/s、P99 {2} ms、卸載 {3}%、5xx {4}、失敗 {5}、JMeter CPU {6}%" -f `
        $threads, $stats.acceptedThroughputPerSec, $stats.p99, [math]::Round($stats.shedRatio * 100, 1), `
        $stats.errors5xx, $stats.failures, `
        ($(if ($null -eq $jmeterCpuPct) { 'n/a' } else { $jmeterCpuPct })))

    # P4：不再死等固定秒數，改 poll 到 backlog 排空（outbox PENDING==0 且 consumer lag==0）才進下一階
    if ($stepIndex -lt $Steps.Count) {
        Wait-ForQuiescence -FallbackCooldownSeconds $CooldownSeconds -MaxWaitSeconds $MaxQuiesceSeconds
    }
}

$ladderEndMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

$summary = [ordered]@{
    ladderId = $ladderId
    game = "fishing"
    startMs = $ladderStartMs
    endMs = $ladderEndMs
    durationSecondsPerStep = $DurationSeconds
    warmupSeconds = $WarmupSeconds
    buyIn = $BuyIn
    cannonLevel = $CannonLevel
    betPerShot = $BetPerShot
    pacingMs = $PacingMs
    # T-090 P1：施壓模型已從 closed-loop（ConstantTimer）改為 open-model（PreciseThroughputTimer，
    # 依牆鐘排程發送）。pacingMs 已不控制節奏，保留只為記錄；目標速率 = target_rps = 該階 threads
    # （shots/sec）。open-model 下慢請求會真的堆積，P99 不再被 coordinated omission 系統性低估。
    loadModel = "open-model (PreciseThroughputTimer, target_rps = threads shots/sec)"
    environment = $environment
    steps = $rows
}
$summary | ConvertTo-Json -Depth 6 | Out-File (Join-Path $ladderDir "ladder-summary.json") -Encoding utf8

# 順手產一張 markdown 表，貼進報告 / 簡報不用再手工排版
$md = @()
$md += "# 捕魚機容量階梯結果（$ladderId）"
$md += ""
$md += "> 施壓模型：**open-model**（PreciseThroughputTimer，target_rps = 該階 threads shots/sec）。慢請求會真的堆積，P99 為誠實值（非 closed-loop 的樂觀值）。"
$md += "> 統計口徑：percentile 只用**穩態窗**（已切掉每階前 $WarmupSeconds 秒暖機；每階 $DurationSeconds 秒，P2）。"
$md += "> 施壓機隔離：各階 ``jmeterHostJavaCpuPct``（見 ladder-summary.json）為 host java（近似 JMeter）平均 CPU%；>25% 代表施壓機在搶 SUT 資源、該階數字打折（P3）。"
$md += "> ⚠️ P6：穩態負載＝連續 shots（多數為純 Redis 累傷；偶發捕獲才走派彩 credit）。**session 從不 ``end``，故殘血回收結算/退款的 DB 寫入不在穩態內**——此吞吐是 shots 路徑上限，非含結算的系統容量，勿當全系統容量引用（要含結算需另跑 start→shots→end 循環計畫，見 T-090-P0-P6.md P6 設計註）。"
$md += ""
$md += "| 併發 | 樣本 | 被接受 | 吞吐(req/s) | P50(ms) | P95(ms) | P99(ms) | 卸載429 | 卸載率 | 5xx | 失敗 |"
$md += "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
foreach ($r in $rows) {
    $md += ("| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} | {8}% | {9} | {10} |" -f `
        $r.threads, $r.samples, $r.accepted, $r.acceptedThroughputPerSec, $r.p50, $r.p95, $r.p99, `
        $r.shed429, [math]::Round($r.shedRatio * 100, 1), $r.errors5xx, $r.failures)
}

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

Write-Host "[fishing-ladder] 完成：$ladderDir"
Write-Host "[fishing-ladder] 時間窗（給 Grafana 截圖用）：from=$ladderStartMs to=$ladderEndMs"
