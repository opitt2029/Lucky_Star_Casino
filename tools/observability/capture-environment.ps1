# ============================================================
# 壓測環境快照（capacity ladder 用）— T-090 P0
#
# 為什麼要這個：#240 與 #242 兩份老虎機報告在「同 jmx、同參數、同機、同一天」下
# 吞吐差 4 倍（200/s vs 818/s），無法重現。根因是 ladder-summary.json 只記了
# bet / pacing / 宣告容量，卻沒記「真正決定結果的環境」——各服務實際 HikariCP 連線
# 池大小、程式碼版本（git SHA）、同機還在吃資源的容器。沒記錄＝不可重現＝數字不能引用。
#
# 本檔提供 Get-CapacityEnvironmentSnapshot：在階梯開跑前打一次快照，寫進
# ladder-summary.json 的 environment 欄位，讓每一輪數字都能對回「當時的環境」。
#
# 用法（在階梯腳本裡 dot-source）：
#   . (Join-Path $scriptDir "capture-environment.ps1")
#   $environment = Get-CapacityEnvironmentSnapshot -RepoRoot $repoRoot
# ============================================================

function Get-CapacityEnvironmentSnapshot {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        # 各後端服務的 actuator port；抓 hikaricp.connections.max 確認「這一輪實際生效的池上限」
        [System.Collections.IDictionary]$Services = ([ordered]@{
                game   = 8083
                wallet = 8082
                member = 8081
                rank   = 8084
                admin  = 8086
            })
    )

    $snapshot = [ordered]@{}
    $snapshot.capturedAtUtc = [DateTimeOffset]::UtcNow.ToString("o")

    # 1) 程式碼版本：哪一版跑出來的數字，之後才對得回去。
    #    native git 失敗不會丟例外（只設 $LASTEXITCODE），故用 exit code 判斷、失敗記 null。
    $sha = (& git -C $RepoRoot rev-parse HEAD)
    $snapshot.gitSha = if ($LASTEXITCODE -eq 0 -and $sha) { "$sha".Trim() } else { $null }
    $branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD)
    $snapshot.gitBranch = if ($LASTEXITCODE -eq 0 -and $branch) { "$branch".Trim() } else { $null }

    # 2) 各服務實際生效的 HikariCP 連線池上限（瓶頸的直接證據；不同輪很可能被人改過）。
    #    actuator /metrics/hikaricp.connections.max：measurements 的 VALUE 是（跨池加總的）上限，
    #    availableTags 的 pool 值列出有哪幾個池（wallet 是雙資料源＝兩個池，ADR-001）。
    $pools = [ordered]@{}
    foreach ($name in $Services.Keys) {
        $port = $Services[$name]
        $uri = "http://localhost:$port/actuator/metrics/hikaricp.connections.max"
        try {
            $resp = Invoke-RestMethod -Uri $uri -TimeoutSec 3 -ErrorAction Stop
            $valueMeasurement = $resp.measurements | Where-Object { $_.statistic -eq 'VALUE' } | Select-Object -First 1
            $poolTag = $resp.availableTags | Where-Object { $_.tag -eq 'pool' } | Select-Object -First 1
            $pools[$name] = [ordered]@{
                port                = $port
                maxConnectionsTotal = $valueMeasurement.value
                poolNames           = @($poolTag.values)
            }
        }
        catch {
            # 服務沒起來 / 沒開 actuator：記 null 而非略過，讓「當時抓不到」本身留在報告裡（別假裝有量到）
            $pools[$name] = [ordered]@{
                port                = $port
                maxConnectionsTotal = $null
                error               = "$($_.Exception.Message)"
            }
        }
    }
    $snapshot.hikaricpConnectionsMax = $pools

    # 3) 同機資源競爭快照：JMeter、IDE、防毒、prac-* 容器都可能偷 SUT 的 CPU（P3 的前置證據）。
    try {
        $lines = & docker stats --no-stream --format "{{.Name}}|cpu={{.CPUPerc}}|mem={{.MemUsage}}"
        $snapshot.dockerStats = if ($LASTEXITCODE -eq 0) { @($lines) } else { $null }
    }
    catch {
        $snapshot.dockerStats = $null
    }

    return $snapshot
}
