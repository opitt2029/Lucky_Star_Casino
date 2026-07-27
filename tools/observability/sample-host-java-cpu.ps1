# ============================================================
# 施壓機 JMeter CPU 取樣（capacity ladder 用）— T-090 P3
#
# 為什麼要這個：單機壓測時 1000 個 JMeter 執行緒 + 15 個容器擠同一台，JMeter 自己吃掉的 CPU
# 會被誤算進「SUT 撐不住」。P0 的 docker stats 只量得到「容器」的 CPU，量不到 JMeter——因為
# JMeter 是 Windows host 上的 java.exe，不在容器裡。本檔補這一塊：量整段 step 期間 host java
# 行程的平均 CPU%，若 > 20~30% 代表施壓機在跟 SUT 搶資源，該輪吞吐數字要打折看待。
#
# 量法：JMeter 的 java 行程「起於 step、終於 step」，用「跑完後讀 .CPU」抓不到（行程已消失、
# 累積 CPU 隨之消失）。故用背景 job 在 step 進行中每 2 秒取樣一次 host 所有 java 行程的累積
# CPU 秒數（Process.CPU），事後取「窗內最大 - 最小」÷ 窗長 ÷ 邏輯核數 = 平均整機 CPU%。
# 刻意不用 Get-Counter '\Process(...)\% Processor Time'——該計數器路徑在非英文 Windows 會被
# 在地化（zh-TW 需中文計數器名），跨機器容易壞；.CPU 是 .NET 屬性、與語系無關。
#
# 口徑注意：host java 可能同時有 IDE/Gradle 等其他 java，故這是「host java CPU%（近似 JMeter）」，
# 非純 JMeter。壓測機理應只跑 JMeter，偏差有限；報告據此標註即可。
#
# 用法（在階梯腳本裡 dot-source，包住單一 step 的 JMeter 呼叫）：
#   . (Join-Path $scriptDir "sample-host-java-cpu.ps1")
#   $sampler = Start-HostJavaCpuSampler
#   & <run one step / blocking jmeter> ...
#   $jmeterCpuPct = Stop-HostJavaCpuSampler -Job $sampler
# ============================================================

function Start-HostJavaCpuSampler {
    # 回傳背景 job；每 2 秒輸出一筆 { t = unixMs, cpu = host 所有 java 行程累積 CPU 秒數之和 }。
    # 全程 try/catch，取樣失敗只輸出 0，絕不讓取樣器把階梯搞掛。
    try {
        return Start-Job -ScriptBlock {
            while ($true) {
                $sum = 0.0
                try {
                    $m = (Get-Process -Name java -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum).Sum
                    if ($null -ne $m) { $sum = [double]$m }
                }
                catch {}
                [pscustomobject]@{ t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); cpu = $sum }
                Start-Sleep -Seconds 2
            }
        }
    }
    catch {
        return $null
    }
}

function Stop-HostJavaCpuSampler {
    # 停 job、收樣本、算平均整機 CPU%。任何異常/樣本不足回 $null（代表「這輪沒量到」，非 0）。
    param(
        $Job,
        [int]$LogicalCpus = [Environment]::ProcessorCount
    )
    if ($null -eq $Job) { return $null }
    try {
        Stop-Job $Job -ErrorAction SilentlyContinue
        $samples = @(Receive-Job $Job -ErrorAction SilentlyContinue)
        Remove-Job $Job -Force -ErrorAction SilentlyContinue

        $valid = @($samples | Where-Object { $_.cpu -gt 0 })
        if ($valid.Count -lt 2) { return $null }

        $minCpu = ($valid | Measure-Object -Property cpu -Minimum).Minimum
        $maxCpu = ($valid | Measure-Object -Property cpu -Maximum).Maximum
        $minT = ($valid | Measure-Object -Property t -Minimum).Minimum
        $maxT = ($valid | Measure-Object -Property t -Maximum).Maximum
        $wallSec = [Math]::Max(1, ($maxT - $minT) / 1000.0)
        $cores = [Math]::Max(1, $LogicalCpus)
        return [Math]::Round((($maxCpu - $minCpu) / $wallSec / $cores) * 100, 1)
    }
    catch {
        return $null
    }
}
