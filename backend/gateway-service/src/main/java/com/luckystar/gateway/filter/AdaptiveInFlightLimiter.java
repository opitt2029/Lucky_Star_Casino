package com.luckystar.gateway.filter;

import com.luckystar.gateway.config.ConcurrencyLimitProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Arrays;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLongArray;

/**
 * 單一路徑前綴的「動態在途上限」限流器（T-090 C3，方案 D：Adaptive In-flight Limit）。
 *
 * <p>兩層保護（見設計文件 §2「為什麼 D 勝過 C」）：
 * <ol>
 *   <li><b>Little's Law 即時層</b>：在途上限固定的瞬間，後端延遲一惡化，放行速率
 *       自動等比例下降（在途 = 速率 × 延遲），零延遲生效，不等任何觀測窗。</li>
 *   <li><b>AIMD 回饋層</b>：每個調整週期看一次 P95——超標乘法收緊（×0.8）、達標
 *       加法放寬（+2），把上限慢慢收斂到「這台機器身後的真容量」。回饋失效
 *       （無流量、觀測異常）時上限維持原值，退化成固定上限仍然安全。</li>
 * </ol></p>
 *
 * <p>延遲觀測是 per-instance 記憶體內的 tumbling window：admitted 請求結束時把耗時
 * 寫進固定容量的 ring buffer，調整時取樣本算 P95 後歸零重開窗。與調整同時進行的
 * record() 可能少量落入新舊窗交界，屬可接受雜訊（AIMD 對單點雜訊天生耐受——
 * 下一窗就修正回來），不為此加鎖以維持熱路徑零同步。</p>
 */
class AdaptiveInFlightLimiter {

    private static final Logger log = LoggerFactory.getLogger(AdaptiveInFlightLimiter.class);

    /** 每窗最多保留的延遲樣本數；超過即丟棄（P95 對後續樣本不敏感，容量換確定性記憶體） */
    static final int WINDOW_CAPACITY = 2048;

    private final ConcurrencyLimitProperties.Route route;
    private final AtomicInteger inFlight = new AtomicInteger();
    private final AtomicInteger maxInFlight;

    private final AtomicLongArray samples = new AtomicLongArray(WINDOW_CAPACITY);
    private final AtomicInteger sampleCount = new AtomicInteger();

    AdaptiveInFlightLimiter(ConcurrencyLimitProperties.Route route) {
        this.route = route;
        this.maxInFlight = new AtomicInteger(route.maxInFlight());
    }

    String pathPrefix() {
        return route.pathPrefix();
    }

    int currentMax() {
        return maxInFlight.get();
    }

    /**
     * 嘗試占用一個在途名額。拒絕路徑維持 C1 的零 I/O 約束：純 AtomicInteger 操作。
     *
     * @return true=放行（呼叫端必須保證之後呼叫 {@link #release}）；false=超限應拒絕
     */
    boolean tryAcquire() {
        int current = inFlight.incrementAndGet();
        if (current > maxInFlight.get()) {
            inFlight.decrementAndGet();
            // 只在 debug 記錄個別拒絕：飽和時 warn 會刷爆 log，總量可由 429 回應計量觀測
            log.debug("Concurrency limit reached ({}/{}) for prefix {}",
                    current, maxInFlight.get(), route.pathPrefix());
            return false;
        }
        return true;
    }

    /** 歸還名額並記錄本次耗時（只對 admitted 請求呼叫；取消/錯誤也要歸還） */
    void release(long latencyMs) {
        inFlight.decrementAndGet();
        int idx = sampleCount.getAndIncrement();
        if (idx < WINDOW_CAPACITY) {
            samples.set(idx, latencyMs);
        }
    }

    /**
     * AIMD 調整（由排程每個週期呼叫一次）：
     * P95 &gt; target → max = max(floor, max×0.8)；P95 ≤ target 且本窗有流量 →
     * max = min(ceiling, max+2)；無流量 → 不動（避免閒置時上限漂移）。
     */
    void adjust() {
        int count = sampleCount.getAndSet(0);
        if (count == 0) {
            return;
        }
        long p95 = percentile95(Math.min(count, WINDOW_CAPACITY));
        int before = maxInFlight.get();
        int after;
        if (p95 > route.latencyTargetMs()) {
            after = Math.max(route.floor(), (int) (before * 0.8));
        } else {
            after = Math.min(route.ceiling(), before + 2);
        }
        if (after != before) {
            maxInFlight.set(after);
            log.info("Adaptive concurrency limit for {} adjusted {} -> {} (window p95={}ms, target={}ms, samples={})",
                    route.pathPrefix(), before, after, p95, route.latencyTargetMs(), count);
        }
    }

    private long percentile95(int n) {
        long[] copy = new long[n];
        for (int i = 0; i < n; i++) {
            copy[i] = samples.get(i);
        }
        Arrays.sort(copy);
        // ceil(0.95n) 的第 k 順位（1-based）→ 0-based 索引 k-1
        int idx = Math.max(0, (int) Math.ceil(n * 0.95) - 1);
        return copy[idx];
    }
}
