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

function Get-HikariMaxFromPrometheusEndpoint {
    # 從 /actuator/prometheus 的文字格式解 hikaricp_connections_max，回 @{ total; poolNames }。
    # 用途：/actuator/metrics 被服務自身的 Spring Security 擋掉時（member-service 就是）仍能取值。
    # 格式範例：hikaricp_connections_max{pool="HikariPool-1",} 40.0
    param([string]$SutHost = "localhost", [Parameter(Mandatory = $true)][int]$Port)
    try {
        $text = Invoke-RestMethod -Uri "http://${SutHost}:$Port/actuator/prometheus" -TimeoutSec 5 -ErrorAction Stop
        $total = 0.0
        $poolNames = @()
        $found = $false
        foreach ($line in ("$text" -split "`n")) {
            if ($line -notmatch '^hikaricp_connections_max\{') { continue }
            if ($line -match 'pool="([^"]+)"') { $poolNames += $Matches[1] }
            $value = ($line -split '\s+')[-1]
            $parsed = 0.0
            if ([double]::TryParse($value, [ref]$parsed)) {
                $total += $parsed
                $found = $true
            }
        }
        if (-not $found) { return $null }
        return @{ total = $total; poolNames = $poolNames }
    }
    catch { return $null }
}

function Get-CapacityEnvironmentSnapshot {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        # 被測系統所在主機。施壓機搬到另一台筆電後，actuator 要打過網路而不是 localhost。
        [string]$SutHost = "localhost",
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
    $snapshot.sutHost = $SutHost

    # 1) 程式碼版本：哪一版跑出來的數字，之後才對得回去。
    #    native git 失敗不會丟例外（只設 $LASTEXITCODE），故用 exit code 判斷、失敗記 null。
    $sha = (& git -C $RepoRoot rev-parse HEAD)
    $snapshot.gitSha = if ($LASTEXITCODE -eq 0 -and $sha) { "$sha".Trim() } else { $null }
    $branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD)
    $snapshot.gitBranch = if ($LASTEXITCODE -eq 0 -and $branch) { "$branch".Trim() } else { $null }

    # 2) 各服務實際生效的 HikariCP 連線池上限（瓶頸的直接證據；不同輪很可能被人改過）。
    #    actuator /metrics/hikaricp.connections.max：measurements 的 VALUE 是（跨池加總的）上限，
    #    availableTags 的 pool 值列出有哪幾個池（wallet 是雙資料源＝兩個池，ADR-001）。
    #    2026-07-22：先打一發 /actuator/health 暖機。HikariCP 的 metric 要等連線池真的被建立
    #    才會註冊，服務剛起、還沒有任何 DB 流量時 hikaricp.connections.max 抓不到（member-service
    #    每次都缺一格就是這個原因）。health 的 db 指標會實際碰一次 DB，足以把池叫醒。
    foreach ($name in $Services.Keys) {
        try {
            Invoke-RestMethod -Uri "http://${SutHost}:$($Services[$name])/actuator/health" -TimeoutSec 3 -ErrorAction Stop | Out-Null
        }
        catch { }
    }

    $pools = [ordered]@{}
    foreach ($name in $Services.Keys) {
        $port = $Services[$name]
        $uri = "http://${SutHost}:$port/actuator/metrics/hikaricp.connections.max"
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
            # /actuator/metrics 不是每個服務都開放：member-service 的 SecurityConfig 只 permitAll
            # health/info/prometheus，打 metrics 會回 403——這就是 member 每輪快照都缺一格的真正原因
            # （不是「服務沒起來」，也不是連線池沒暖機）。不去放寬它的安全設定（metrics 會列出所有
            # 指標名與值），改從已開放的 /actuator/prometheus 解同一個數字。
            $fallback = Get-HikariMaxFromPrometheusEndpoint -SutHost $SutHost -Port $port
            if ($null -ne $fallback) {
                $pools[$name] = [ordered]@{
                    port                = $port
                    maxConnectionsTotal = $fallback.total
                    poolNames           = $fallback.poolNames
                    source              = "actuator/prometheus（/actuator/metrics 不可用：$($_.Exception.Message)）"
                }
            }
            else {
                # 兩條路都讀不到：記 null 而非略過，讓「當時抓不到」本身留在報告裡（別假裝有量到）
                $pools[$name] = [ordered]@{
                    port                = $port
                    maxConnectionsTotal = $null
                    error               = "$($_.Exception.Message)"
                }
            }
        }
    }
    $snapshot.hikaricpConnectionsMax = $pools

    # 3) 同機資源競爭快照：JMeter、IDE、防毒、prac-* 容器都可能偷 SUT 的 CPU（P3 的前置證據）。
    #    （施壓機在另一台機器時這裡抓不到 SUT 的 docker，記 null 即可——那正是我們想要的隔離。）
    try {
        $lines = & docker stats --no-stream --format "{{.Name}}|cpu={{.CPUPerc}}|mem={{.MemUsage}}"
        $snapshot.dockerStats = if ($LASTEXITCODE -eq 0) { @($lines) } else { $null }
    }
    catch {
        $snapshot.dockerStats = $null
    }

    # 4) 「容器跑的是不是這一版程式碼」——2026-07-22 差點用舊 image 出報告的教訓。
    #    當時 actuator 實測連線池 game=24 / wallet=42，但 develop HEAD 的設定是 40 / 40+10，
    #    因為 image 建於該 commit 之前。沒抓到的話，整份報告會把舊 build 的數字標成 HEAD。
    #    判定方式是啟發式的：比對「image 建置時間」與「HEAD commit 時間」，image 較舊即可疑。
    #    （不是精確判定——image 可能是從別的分支建的——所以只警告並記進快照，不中止階梯。
    #    要精確判定得在 Dockerfile 打 GIT_SHA label，那是另一個 PR 的範圍。）
    $snapshot.staleImageWarnings = @()
    try {
        $headIso = (& git -C $RepoRoot show -s --format=%cI HEAD)
        if ($LASTEXITCODE -eq 0 -and $headIso) {
            $headTime = [DateTimeOffset]::Parse("$headIso".Trim())
            $imageLines = & docker images --format "{{.Repository}}|{{.CreatedAt}}"
            if ($LASTEXITCODE -eq 0) {
                foreach ($line in @($imageLines)) {
                    $parts = "$line".Split('|')
                    if ($parts.Count -lt 2) { continue }
                    if ($parts[0] -notlike "*lucky*") { continue }
                    $created = $null
                    if ([DateTimeOffset]::TryParse($parts[1], [ref]$created)) {
                        if ($created -lt $headTime) {
                            $snapshot.staleImageWarnings += ("{0} 建於 {1}，早於 HEAD commit（{2}）——容器可能不是這一版程式碼" -f `
                                $parts[0], $created.ToString('u'), $headTime.ToString('u'))
                        }
                    }
                }
            }
        }
    }
    catch { }
    foreach ($warning in $snapshot.staleImageWarnings) {
        Write-Host "[env] ⚠️ $warning"
    }
    if ($snapshot.staleImageWarnings.Count -gt 0) {
        Write-Host "[env] ⚠️ 上列 image 早於 HEAD：請先 `docker compose build` 再重測，否則報告會標錯版本。"
    }

    return $snapshot
}
