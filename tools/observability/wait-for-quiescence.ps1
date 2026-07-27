# ============================================================
# 階間排空等待（capacity ladder 用）— T-090 P4
#
# 為什麼要這個：舊做法是每階之間 Start-Sleep 固定 20 秒。但 outbox 尖峰曾達 10,064 PENDING、
# Kafka consumer lag 尖峰 365，固定 20 秒未必排得完——下一階起跑時還在消化上一階的積壓，
# P99 被殘留 backlog 污染。反過來若系統很快就排空，固定 20 秒又是白等。
#
# 本檔提供 Wait-ForQuiescence：poll 到「wallet_outbox PENDING==0 且 consumer lag==0」才進下一階，
# 取代死等。兩個訊號來源不同、可用性不同，故採「可讀的維度就 gate、讀不到的維度優雅退回」：
#   - consumer lag：查 Prometheus（:9090）的 kafka_consumer_fetch_manager_records_lag_max（reliable）。
#   - outbox PENDING：查 wallet actuator /metrics/wallet.outbox.pending（服務未起/未含此指標時讀不到）。
# 若兩個維度都讀不到（環境沒 Prometheus 也沒 wallet actuator）→ 退回固定 FallbackCooldownSeconds，
# 絕不無限等（有 MaxWaitSeconds 上限），也絕不 0 冷卻（有 MinCooldownSeconds 地板）。
#
# 用法（在階梯腳本裡 dot-source）：
#   . (Join-Path $scriptDir "wait-for-quiescence.ps1")
#   Wait-ForQuiescence -FallbackCooldownSeconds $CooldownSeconds -MaxWaitSeconds $MaxQuiesceSeconds
# ============================================================

function Get-OutboxPending {
    # 回傳 wallet_outbox 內 PENDING 筆數；讀不到回 $null（代表「這個維度看不到」，非 0）
    param([int]$WalletPort = 8082, [string]$SutHost = "localhost")
    try {
        $resp = Invoke-RestMethod -Uri "http://${SutHost}:$WalletPort/actuator/metrics/wallet.outbox.pending" -TimeoutSec 3 -ErrorAction Stop
        $m = $resp.measurements | Where-Object { $_.statistic -eq 'VALUE' } | Select-Object -First 1
        if ($null -eq $m) { return $null }
        return [double]$m.value
    }
    catch { return $null }
}

function Get-MaxConsumerLag {
    # 回傳全服務最大 consumer lag；讀不到 / NaN（無在線 consumer 樣本）回 $null
    param([string]$PrometheusUrl = "http://localhost:9090")
    try {
        $q = [uri]::EscapeDataString("max(kafka_consumer_fetch_manager_records_lag_max)")
        $resp = Invoke-RestMethod -Uri "$PrometheusUrl/api/v1/query?query=$q" -TimeoutSec 3 -ErrorAction Stop
        if ($resp.status -ne 'success' -or -not $resp.data.result) { return $null }
        $raw = $resp.data.result[0].value[1]
        $val = [double]$raw
        if ([double]::IsNaN($val)) { return $null }
        return $val
    }
    catch { return $null }
}

function Wait-ForQuiescence {
    param(
        [int]$WalletPort = 8082,
        # 施壓機與 SUT 分機時，outbox / Prometheus 都要打過網路。給了 $SutHost 就自動組出
        # 預設的 Prometheus 位址，呼叫端不必兩個參數都傳。
        [string]$SutHost = "localhost",
        [string]$PrometheusUrl = "",
        [int]$PollIntervalSeconds = 3,
        [int]$MinCooldownSeconds = 5,          # 地板：無論如何先給一點 settle 時間
        [int]$MaxWaitSeconds = 90,             # 上限：逾時就繼續，絕不卡死階梯
        [int]$FallbackCooldownSeconds = 20     # 兩個維度都讀不到時，退回這個固定冷卻（＝舊行為）
    )

    if ([string]::IsNullOrWhiteSpace($PrometheusUrl)) {
        $PrometheusUrl = "http://${SutHost}:9090"
    }

    Start-Sleep -Seconds $MinCooldownSeconds

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds([Math]::Max(0, $MaxWaitSeconds - $MinCooldownSeconds))
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        $pending = Get-OutboxPending -WalletPort $WalletPort -SutHost $SutHost
        $lag = Get-MaxConsumerLag -PrometheusUrl $PrometheusUrl

        # 兩個維度都看不到 → 沒有可信訊號可 gate，退回固定冷卻後放行
        if ($null -eq $pending -and $null -eq $lag) {
            $remain = [Math]::Max(0, $FallbackCooldownSeconds - $MinCooldownSeconds)
            Write-Host "[quiesce] outbox/lag 皆讀不到（服務未起或無指標）→ 退回固定冷卻 ${FallbackCooldownSeconds}s"
            if ($remain -gt 0) { Start-Sleep -Seconds $remain }
            return
        }

        # 只對「讀得到」的維度要求已排空；讀不到的維度略過（避免因單一指標缺席而卡到逾時）
        $pendingDrained = ($null -eq $pending) -or ($pending -le 0)
        $lagDrained = ($null -eq $lag) -or ($lag -le 0)
        if ($pendingDrained -and $lagDrained) {
            Write-Host ("[quiesce] backlog 已排空（outbox PENDING={0}, consumer lag={1}）" -f `
                ($(if ($null -eq $pending) { 'n/a' } else { $pending })), ($(if ($null -eq $lag) { 'n/a' } else { $lag })))
            return
        }

        Write-Host ("[quiesce] 等待排空... outbox PENDING={0}, consumer lag={1}" -f `
            ($(if ($null -eq $pending) { 'n/a' } else { $pending })), ($(if ($null -eq $lag) { 'n/a' } else { $lag })))
        Start-Sleep -Seconds $PollIntervalSeconds
    }

    Write-Host "[quiesce] ⚠️ 逾時 ${MaxWaitSeconds}s 仍未確認完全排空，繼續下一階（該階 P99 可能被殘留 backlog 污染，報告請留意）"
}
