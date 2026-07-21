# ============================================================
# 壓測 + 出圖一條龍：跑 JMeter → 產驗收報告 → 依「這一輪的實際時間窗」截 Grafana 圖
#
# 為什麼要包一層：
#   Grafana 圖的說服力來自「時間範圍剛好框住這一輪壓測」。手動選時間很容易框歪
#   （框太寬會被前後的閒置期稀釋、框太窄會漏掉尾段）。這支腳本在跑之前/之後各記一次
#   時間戳，截圖時直接用這兩個時間點，圖與數字必然對得起來。
#
# 用法（先確認 7 個服務與 Prometheus/Grafana 都跑著、players.csv 已備妥）：
#   powershell -File tools/observability/run-loadtest-with-charts.ps1 -Threads 150 -Label acceptance-150
#
# 參數說明見下方 param 區塊；JMeter 路徑用 -JMeter 指定（本專案不內建 JMeter）。
# ============================================================
param(
    [Parameter(Mandatory = $true)][string]$JMeter,       # jmeter.bat 完整路徑
    [int]$Threads = 150,
    [int]$DurationSeconds = 60,
    [int]$RampUpSeconds = 1,
    [int]$DeclaredCapacity = 150,
    [int]$Bet = 100,
    [int]$PacingMs = 1000,
    [string]$Label = "run",                              # 給輸出資料夾用的可讀標籤
    [string]$DashboardUid = "lucky-star-loadtest",
    [string]$Theme = "dark",
    [int]$PaddingSeconds = 30                            # 圖的時間窗前後各留一點，看得到起跑與收尾
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")

# JMeter 執行緒多時，預設 1GB heap 會不夠；同時把單執行緒堆疊縮小，
# 1,000 執行緒下可省下數百 MB（壓測機自己 OOM 會讓數據失真）。
if (-not $env:JVM_ARGS) { $env:JVM_ARGS = "-Xss256k" }
if (-not $env:HEAP) { $env:HEAP = "-Xms512m -Xmx2g -XX:MaxMetaspaceSize=256m" }

$startMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
Write-Host "[run-loadtest-with-charts] start=$startMs threads=$Threads label=$Label"

# 用「子行程」跑 runner，而不是 dot-source／同行程呼叫：
# runner 在 gate 沒過時是 throw（終止性錯誤），同行程會連帶把本腳本也中斷 →
# 圖就截不成了。但「gate 沒過」正是最需要圖來解釋的時候，所以這裡只收 exit code。
$runnerPath = Join-Path $repoRoot "tests\performance\run-slot-load-test.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File $runnerPath `
    -JMeter $JMeter `
    -Threads $Threads `
    -DurationSeconds $DurationSeconds `
    -RampUpSeconds $RampUpSeconds `
    -DeclaredCapacity $DeclaredCapacity `
    -Bet $Bet `
    -PacingMs $PacingMs
$runnerExit = $LASTEXITCODE

$endMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
Write-Host "[run-loadtest-with-charts] end=$endMs runnerExit=$runnerExit"

# 找出這一輪 runner 產出的 results 資料夾（照建立時間取最新那個）
$resultsRoot = Join-Path $repoRoot "tests\performance\results"
$latest = Get-ChildItem -Path $resultsRoot -Directory | Sort-Object CreationTime -Descending | Select-Object -First 1
if ($null -eq $latest) { throw "找不到 results 資料夾：$resultsRoot" }

$chartDir = Join-Path $latest.FullName "grafana"
$from = $startMs - ($PaddingSeconds * 1000)
$to = $endMs + ($PaddingSeconds * 1000)

node (Join-Path $repoRoot "tools\observability\capture-grafana.mjs") `
    --uid $DashboardUid --from $from --to $to --out $chartDir --theme $Theme

# 把這一輪的中繼資料存起來，寫報告時不必回頭猜是哪一輪、時間窗多長
@{
    label = $Label
    threads = $Threads
    durationSeconds = $DurationSeconds
    declaredCapacity = $DeclaredCapacity
    startMs = $startMs
    endMs = $endMs
    runnerExitCode = $runnerExit
    resultDir = $latest.FullName
} | ConvertTo-Json | Out-File -FilePath (Join-Path $latest.FullName "run-meta.json") -Encoding utf8

Write-Host "[run-loadtest-with-charts] 圖表：$chartDir"
Write-Host "[run-loadtest-with-charts] 結果：$($latest.FullName)"
exit $runnerExit
