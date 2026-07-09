package com.luckystar.gateway.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * per-route 併發上限設定，對應 application.yml 的 concurrency-limit 區塊（T-090 C1/C3）。
 *
 * <p>C3 起從單一 game 路徑改為 route 清單：每條 route 各自持有獨立的在途計數與
 * AIMD 動態上限（game 寫路徑與 wallet 讀路徑容量特性不同，共用一個桶會互相污染
 * 回饋訊號，見 docs/performance/T-090-C3-gateway-shedding-design-evaluation.md §3.3）。</p>
 */
@ConfigurationProperties(prefix = "concurrency-limit")
public record ConcurrencyLimitProperties(List<Route> routes) {

    /**
     * 單一路徑前綴的併發上限與 AIMD 邊界。
     *
     * @param pathPrefix       比對的路徑前綴（如 /api/v1/game/），依宣告順序取第一個符合者
     * @param maxInFlight      初始在途上限（AIMD 的起點，非固定值）
     * @param floor            動態下修的保底值——確保收緊再兇也不會絕流
     * @param ceiling          動態上修的天花板——防止長期低延遲讓上限無限爬升
     * @param latencyTargetMs  P95 延遲目標：超標收緊（×0.8）、達標放寬（+2）
     */
    public record Route(String pathPrefix, int maxInFlight, int floor, int ceiling,
                        long latencyTargetMs) {}
}
