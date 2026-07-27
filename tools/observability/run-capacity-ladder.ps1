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
    # ── 遠端施壓機（2026-07-23 起）─────────────────────────────────────────────
    # 施壓機與被測系統同機時，JMeter 自身 CPU 會吃到 34~40%，同時推高 P99、壓低吞吐，
    # 而且發不出超過 ~1,330 req/s（見 T-090-capacity-ladder-5000rps-report-20260722.md §4.4）。
    # 把本腳本放到另一台機器上跑、-SutHost 指向被測主機，就能拿到不受施壓機污染的數字。
    # 這一個參數會同時決定：JMeter 打哪、actuator 快照抓哪、階間排空 poll 哪、token 去哪重發。
    [string]$SutHost = "localhost",
    [int]$SutPort = 8080,          # gateway
    [int]$MemberPort = 8081,       # refresh-player-tokens.mjs 直打 member（繞過 gateway 的 auth 限流）
    [int[]]$Steps = @(25, 50, 100, 150, 300, 600, 1000),
    # ── 高 RPS 模式（2026-07-22 新增）─────────────────────────────────────────
    # $Steps 的語意是「併發數＝目標速率」（歷史耦合：target_rps == threads）。要壓到
    # 5,000 req/s 時這個耦合會逼施壓機開 5,000 條執行緒，JMeter 自己先變成瓶頸（P3）。
    # 給 -OfferedRpsSteps 就改走解耦模式：每階的「目標 offered 速率」由此陣列決定，
    # 執行緒數固定為 -FixedThreads。
    # 單位＝**gateway 收到的 HTTP req/s（spins/s）**；因每個 iteration 送 2 支 spin
    # sampler，實際傳給 JMeter 的 target_rps（iterations/s）= ceil(offered / 2)。
    [int[]]$OfferedRpsSteps = @(),
    [int]$FixedThreads = 1000,
    # 每階各自的執行緒數（與 -OfferedRpsSteps 等長）。留空＝每階都用 $FixedThreads。
    # 為什麼需要：慢請求會把執行緒卡住（jmx response_timeout_ms=5000），能發出的速率上限
    # ≈ threads / 平均週期時間。高階若執行緒不足，量到的是「施壓機發不出來」而非 SUT 容量。
    [int[]]$ThreadsPerStep = @(),
    [int]$SamplersPerIteration = 2,
    # 超過這個目標 offered 速率的階，跳過 JMeter 內建 HTML dashboard：樣本數上看數十萬時，
    # 報表產生器會變成整輪最慢也最吃記憶體的一段（本機可用 RAM 僅個位數 GB）。所有數字都由
    # 原始 .jtl 重算，HTML 只是選配工件。設 0 = 每階都產。
    [int]$HtmlReportMaxOfferedRps = 1000,
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
Write-Host "[ladder] 被測系統：http://${SutHost}:$SutPort（gateway）"
$environment = Get-CapacityEnvironmentSnapshot -RepoRoot $repoRoot -SutHost $SutHost

$ladderStartMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$rows = @()
$stepIndex = 0

# 先把「要跑哪幾階」攤平成計畫表，兩種模式（併發階梯 / 解耦高 RPS 階梯）走同一個迴圈。
$plan = @()
if ($OfferedRpsSteps.Count -gt 0) {
    $decoupled = $true
    if ($ThreadsPerStep.Count -gt 0 -and $ThreadsPerStep.Count -ne $OfferedRpsSteps.Count) {
        throw "-ThreadsPerStep 有 $($ThreadsPerStep.Count) 項，與 -OfferedRpsSteps 的 $($OfferedRpsSteps.Count) 項不等長。"
    }
    for ($i = 0; $i -lt $OfferedRpsSteps.Count; $i++) {
        $rps = $OfferedRpsSteps[$i]
        $plan += [pscustomobject]@{
            threads          = $(if ($ThreadsPerStep.Count -gt 0) { $ThreadsPerStep[$i] } else { $FixedThreads })
            targetRps        = [math]::Ceiling($rps / $SamplersPerIteration)   # iterations/s
            offeredRpsTarget = $rps                                            # spins/s（HTTP req/s）
        }
    }
} else {
    $decoupled = $false
    foreach ($t in $Steps) {
        $plan += [pscustomobject]@{
            threads          = $t
            targetRps        = $t
            offeredRpsTarget = $t * $SamplersPerIteration
        }
    }
}

# ── 開跑前先擋「陣列被 -File 吃掉」（2026-07-23，AGENTS.md 雷區 27）──────────
# 用 `powershell -File ladder.ps1 -ThreadsPerStep 100,3000` 傳陣列時，兩個值會被當成
# 單一字串 "100,3000" 再轉型成 int —— PowerShell 的數字轉型會把逗號當千分位，
# 結果是 **1003000**，而且不會報錯。ThreadsPerStep 與 OfferedRpsSteps 同時被壓成
# 1 元素，所以既有的「兩陣列等長」檢查也抓不到。實測確認過這個行為。
# 這裡只做粗略的合理性上界：單機施壓不可能開到這種量級，撞到就是傳參方式錯了。
$absurdThreads = @($plan | Where-Object { $_.threads -gt 20000 })
$absurdRps = @($plan | Where-Object { $_.offeredRpsTarget -gt 100000 })
if ($absurdThreads.Count -gt 0 -or $absurdRps.Count -gt 0) {
    $threadList = ($plan | ForEach-Object { $_.threads }) -join ','
    $rpsList = ($plan | ForEach-Object { $_.offeredRpsTarget }) -join ','
    $msg = "[ladder] 參數不合理（threads=$threadList；offered=$rpsList req/s）。`n"
    $msg += "  最可能的原因：用「powershell -File」傳了陣列參數。-File 會把「100,3000」當成一個字串"
    $msg += "再轉成數字 1003000（逗號被當千分位），而且不會報錯。`n"
    $msg += "  改用「&」直接呼叫（AGENTS.md 雷區 27）：`n"
    $msg += "    & .\tools\observability\run-capacity-ladder.ps1 -OfferedRpsSteps @(50,100) -ThreadsPerStep @(100,150) ..."
    throw $msg
}

# ── 開跑前先擋玩家數不足（2026-07-23）───────────────────────────────────────
# run-slot-load-test.ps1 每階起跑時會檢查 players.csv 列數 >= threads，不足就 throw。
# 問題是它 throw 在建結果資料夾「之前」，那一階不會留下任何產物——不先擋的話，階梯會
# 一路跑到最貴的高階才失敗（前面已經燒掉 30 分鐘以上），而且失敗方式很難看出來（見下方
# runDir 歸屬判定）。玩家數是開跑前就能確定的事，就在開跑前一次問完。
$playersCsv = Join-Path $repoRoot "tests\performance\players.csv"
if (-not (Test-Path $playersCsv)) {
    throw "[ladder] 找不到 $playersCsv。先跑 tests/performance/provision-players.mjs 準備玩家帳號。"
}
$playerRows = (Get-Content -LiteralPath $playersCsv | Measure-Object -Line).Lines - 1   # 扣掉表頭
$maxThreads = ($plan | ForEach-Object { $_.threads } | Measure-Object -Maximum).Maximum
if ($playerRows -lt $maxThreads) {
    throw ("[ladder] players.csv 只有 {0} 名玩家，但本階梯最高階要開 {1} 條執行緒。`n" +
        "  執行緒數 > 玩家數會讓 JMeter 的 CSV DataSet recycle，兩條執行緒共用同一個玩家 ⇒`n" +
        "  wallet 樂觀鎖衝突，量到的是施壓機造成的假失敗，不是 SUT 的容量極限。`n" +
        "  解法：PLAYERS={2} node tests/performance/provision-players.mjs（建議再多留 100 名裕度），`n" +
        "  或把 -ThreadsPerStep 的上限壓到 {0} 以內。") -f $playerRows, $maxThreads, $maxThreads
}
Write-Host "[ladder] players.csv：$playerRows 名玩家，最高階需 $maxThreads 條執行緒 — 足夠。"

foreach ($step in $plan) {
    $stepIndex++
    $threads = $step.threads
    $targetRps = $step.targetRps

    # JWT 效期 15 分鐘：每 N 階重發一次，避免中後段整批 401 把數據弄髒
    if ((($stepIndex - 1) % $RefreshTokensEverySteps) -eq 0) {
        Write-Host "[ladder] 重發 player token（第 $stepIndex 階前）"
        $env:MEMBER_URL = "http://${SutHost}:$MemberPort"
        & node (Join-Path $repoRoot "tests\performance\refresh-player-tokens.mjs") | Out-Null
        if ($LASTEXITCODE -ne 0) {
            # token 沒換成功就往下跑，中後段會整批 401、整輪數據作廢——寧可現在就停。
            throw "[ladder] refresh-player-tokens.mjs 失敗（exit $LASTEXITCODE），中止階梯。MEMBER_URL=$env:MEMBER_URL"
        }
    }

    Write-Host ("[ladder] === 第 {0}/{1} 階：目標 offered {2} req/s（target_rps={3} iter/s、threads={4}）===" -f `
        $stepIndex, $plan.Count, $step.offeredRpsTarget, $targetRps, $threads)
    $startMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    $extraArgs = @()
    if ($HtmlReportMaxOfferedRps -gt 0 -and $step.offeredRpsTarget -gt $HtmlReportMaxOfferedRps) {
        $extraArgs += '-NoHtmlReport'
    }

    # 開跑前記下「已經存在哪些結果資料夾」，跑完只認新出現的那一個（見下方歸屬判定）。
    # 用名單比對而不是比時間戳：不受兩台機器時鐘差、檔案系統時間精度、時區的影響。
    $runDirsBefore = @(Get-ChildItem -Path $resultsRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike "ladder-*" } | Select-Object -ExpandProperty Name)

    $cpuSampler = Start-HostJavaCpuSampler   # P3：step 進行中量 host java（JMeter）CPU
    & powershell -NoProfile -ExecutionPolicy Bypass -File $runnerPath `
        -JMeter $JMeter -HostName $SutHost -Port $SutPort `
        -Threads $threads -DurationSeconds $DurationSeconds `
        -RampUpSeconds $RampUpSeconds -DeclaredCapacity $DeclaredCapacity `
        -Bet $Bet -PacingMs $PacingMs -TargetRps $targetRps @extraArgs 2>&1 | Out-Null
    $exitCode = $LASTEXITCODE
    $jmeterCpuPct = Stop-HostJavaCpuSampler -Job $cpuSampler   # P3：>25% 代表施壓機在搶 SUT 資源

    $endMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    # 取這一階 runner 產出的資料夾（排除 ladder-* 自己，且必須是這一階「新出現」的）。
    #
    # 2026-07-23：舊寫法是「取最新的一個資料夾」，不管它是不是這一階產生的。runner 在
    # 玩家數不足時會 throw，而那個 throw 發生在 New-Item $resultDir 之前 ⇒ 該階根本沒有
    # 自己的資料夾 ⇒ 舊寫法會靜默取到「上一階」的資料夾，拿上一階的 JTL 重算，產出一列
    # 標著這一階 offeredRpsTarget 的假數據。整輪跑完看起來完全正常。
    # 跟 2026-07-22 修掉的「summarize 失敗靜默寫空白列」是同一類 bug，只是換了個入口：
    # **量測腳本沉默地拿到錯的東西，比大聲失敗危險得多。**
    $runDir = Get-ChildItem -Path $resultsRoot -Directory |
        Where-Object { $_.Name -notlike "ladder-*" -and $_.Name -notin $runDirsBefore } |
        Sort-Object CreationTime -Descending | Select-Object -First 1

    if ($null -eq $runDir) {
        throw ("[ladder] 第 {0} 階（目標 offered {1} req/s、threads={2}）沒有產生任何結果資料夾" +
            "（runner exit={3}）。代表 runner 在建立結果資料夾之前就失敗了，最常見的原因是" +
            "players.csv 列數不足、JMeter 執行檔找不到，或 -JMeter 路徑有誤。`n" +
            "  此處中止：若繼續，這一階會取到上一階的資料夾，產出一列看不出錯的假數據。`n" +
            "  已完成的 {4} 階結果仍在 {5}。") -f `
            $stepIndex, $step.offeredRpsTarget, $threads, $exitCode, ($stepIndex - 1), $ladderDir
    }

    # 直接讀 JTL 重算，不解析 markdown：markdown 是給人看的，格式一改就爆
    $statsJson = & node (Join-Path $scriptDir "summarize-jtl.mjs") (Join-Path $runDir.FullName "results.jtl") $WarmupSeconds
    $summarizeExit = $LASTEXITCODE
    $stats = if ($statsJson) { $statsJson | ConvertFrom-Json } else { $null }

    # 2026-07-22：summarize 崩掉時（曾因 Math.min(...arr) 對數十萬樣本展開而 RangeError），
    # 舊寫法會把整列統計靜默寫成空白、階梯照跑不誤——報告裡就多出一列看不出哪裡錯的空白。
    # 統計算不出來＝那一階沒有資料，必須大聲失敗，不能混進結果表。
    if ($summarizeExit -ne 0 -or $null -eq $stats -or $null -eq $stats.samples) {
        throw ("[ladder] 第 {0} 階（目標 offered {1} req/s）統計計算失敗（summarize-jtl.mjs exit={2}）。" +
            "原始資料仍在 {3}，修正後可單獨重算；此處中止以免空白列混進結果表。") -f `
            $stepIndex, $step.offeredRpsTarget, $summarizeExit, $runDir.FullName
    }

    $row = [ordered]@{
        step = $stepIndex
        threads = $threads
        targetRpsIterationsPerSec = $targetRps          # 傳給 PreciseThroughputTimer 的值
        offeredRpsTarget = $step.offeredRpsTarget       # 目標 HTTP req/s（= targetRps × 每 iteration sampler 數）
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
    Write-Host ("[ladder] 目標 {0} req/s → 實際 offered {1}/s、accepted 吞吐 {2}/s、P99 {3} ms、卸載 {4}%、5xx {5}、帳務違規 {6}、JMeter CPU {7}%" -f `
        $step.offeredRpsTarget, $stats.throughputPerSec, $stats.acceptedThroughputPerSec, $stats.p99, `
        [math]::Round($stats.shedRatio * 100, 1), `
        $stats.errors5xx, ($stats.idempotencyFailures + $stats.overdrawFailures), `
        ($(if ($null -eq $jmeterCpuPct) { 'n/a' } else { $jmeterCpuPct })))

    # P4：不再死等固定秒數，改 poll 到 backlog 排空（outbox PENDING==0 且 consumer lag==0）才進下一階
    if ($stepIndex -lt $plan.Count) {
        Wait-ForQuiescence -SutHost $SutHost -FallbackCooldownSeconds $CooldownSeconds -MaxWaitSeconds $MaxQuiesceSeconds
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
    loadModel = if ($decoupled) {
        $threadNote = if ($ThreadsPerStep.Count -gt 0) { "threads per step = $($ThreadsPerStep -join '/')" } else { "fixed threads = $FixedThreads" }
        "open-model (PreciseThroughputTimer); target rate DECOUPLED from thread pool: offeredRpsTarget = HTTP req/s, target_rps = ceil(offered / $SamplersPerIteration) iterations/sec, $threadNote"
    } else {
        "open-model (PreciseThroughputTimer, target_rps = threads spins/sec)"
    }
    samplersPerIteration = $SamplersPerIteration
    fixedThreads = $(if ($decoupled) { $FixedThreads } else { $null })
    sutHost = $SutHost
    sutPort = $SutPort
    # 施壓機是否與 SUT 同機——決定這一輪的數字能不能對外引用（P3）
    loadGeneratorColocated = ($SutHost -in @('localhost', '127.0.0.1', '::1'))
    environment = $environment
    steps = $rows
}
$summary | ConvertTo-Json -Depth 6 | Out-File (Join-Path $ladderDir "ladder-summary.json") -Encoding utf8

# 順手產一張 markdown 表，貼進報告 / 簡報不用再手工排版
$md = @()
$md += "# 容量階梯結果（$ladderId）"
$md += ""
$md += "> 施壓模型：**open-model**（PreciseThroughputTimer）。$($summary.loadModel)"
$md += "> 「目標offered」= 想打進 gateway 的 HTTP req/s；「實際offered」= JTL 實測總樣本速率（施壓機跟不上排程時會低於目標，此時該階是**施壓機**受限、不是 SUT 容量）。"
$md += "> 統計口徑：percentile 只用**穩態窗**（已切掉每階前 $WarmupSeconds 秒暖機；每階 $DurationSeconds 秒，P2）。"
$md += "> 施壓機隔離：各階 ``jmeterHostJavaCpuPct``（見 ladder-summary.json）為 host java（近似 JMeter）平均 CPU%；>25% 代表施壓機在搶 SUT 資源、該階數字打折（P3）。docker stats 快照見下方環境段。"
$md += ""
$md += "| 目標offered(req/s) | 併發 | 樣本 | 實際offered(req/s) | 被接受 | accepted吞吐(req/s) | P50(ms) | P95(ms) | P99(ms) | 卸載429 | 卸載率 | 5xx | 冪等違規 | 超扣違規 |"
$md += "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
foreach ($r in $rows) {
    $md += ("| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} | {8} | {9} | {10}% | {11} | {12} | {13} |" -f `
        $r.offeredRpsTarget, $r.threads, $r.samples, $r.throughputPerSec, $r.accepted, $r.acceptedThroughputPerSec, `
        $r.p50, $r.p95, $r.p99, `
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
$md += "- 被測系統：``http://${SutHost}:$SutPort``；施壓機與 SUT " + $(if ($summary.loadGeneratorColocated) { "**同機**（P3 未隔離，絕對數字為悲觀下界、不可對外引用）" } else { "**分機**（P3 已隔離）" })
if ($environment.staleImageWarnings -and $environment.staleImageWarnings.Count -gt 0) {
    $md += ""
    $md += "> ⚠️ **image 版本可疑**（容器可能不是這一版程式碼）："
    foreach ($warning in $environment.staleImageWarnings) { $md += ">   - $warning" }
}
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
