package com.luckystar.gateway.filter;

import com.luckystar.gateway.config.ConcurrencyLimitProperties;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * per-route 全局併發上限（load shedding，T-090 C1 固定上限 → C3 動態在途上限）。
 *
 * <p>對設定的每個路徑前綴各自維護「在途請求」計數：超過上限的請求立即回 429 +
 * Retry-After，不進入後續 JWT 驗證與轉發——被拒請求不佔用 Redis 撤銷檢查與後端資源，
 * 讓被接受的請求維持低延遲（「明確拒絕少數、保障多數」，取代「全收排隊、大家一起慢」）。</p>
 *
 * <p>設計取捨：
 * <ul>
 *   <li>放在 JWT 驗證（-100）之前執行：卸載時連 3 次 Redis 查詢都省下，
 *       直接縮小高併發下 fail-closed 401 的暴露面（T-090 實測 1,000 併發 401 雪崩）。</li>
 *   <li>計數是單機記憶體 AtomicInteger（非 Redis）：併發上限本質是「這台 gateway 實例
 *       身後的容量」，本來就該 per-instance；不引入 Redis 往返，拒絕路徑 O(1) 零 I/O。</li>
 *   <li>與 PlayerRateLimitGlobalFilter（每玩家速率）互補：那是公平性（單一玩家不能獨占），
 *       這是總量保護（全體加起來不能壓垮後端）。</li>
 *   <li>C3 起上限不再是固定值：每條 route 由 {@link AdaptiveInFlightLimiter} 以 AIMD
 *       依 P95 延遲動態調整（floor/ceiling 夾住），回饋失效時退化成固定上限仍安全。
 *       game 與 wallet 各持獨立限流器——兩者容量特性不同，共用會互相污染回饋訊號。</li>
 * </ul></p>
 */
@Component
public class RouteConcurrencyLimitGlobalFilter implements GlobalFilter, Ordered {

    private static final String BODY_429 =
            "{\"success\":false,\"data\":null,\"message\":\"Server busy, please retry\"}";

    private final List<AdaptiveInFlightLimiter> limiters;

    public RouteConcurrencyLimitGlobalFilter(ConcurrencyLimitProperties props) {
        this.limiters = props.routes().stream().map(AdaptiveInFlightLimiter::new).toList();
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        AdaptiveInFlightLimiter limiter = limiterFor(path);
        if (limiter == null) {
            return chain.filter(exchange);
        }

        if (!limiter.tryAcquire()) {
            return reject429(exchange);
        }
        long startNanos = System.nanoTime();
        // doFinally 涵蓋正常完成/錯誤/取消（client 斷線）三種結束路徑，保證計數歸還；
        // 耗時一併回報給 AIMD 觀測窗（取消的短樣本屬雜訊，AIMD 下一窗即自我修正）
        return chain.filter(exchange)
                .doFinally(signal ->
                        limiter.release((System.nanoTime() - startNanos) / 1_000_000));
    }

    /** 每個週期對所有 route 跑一次 AIMD 調整（P95 觀測與調整全在記憶體，無 I/O） */
    @Scheduled(fixedRateString = "${concurrency-limit.adjust-interval-ms:5000}")
    public void adjustLimits() {
        limiters.forEach(AdaptiveInFlightLimiter::adjust);
    }

    /** 依宣告順序取第一個符合的前綴；無符合＝不設限路徑 */
    AdaptiveInFlightLimiter limiterFor(String path) {
        for (AdaptiveInFlightLimiter limiter : limiters) {
            if (path.startsWith(limiter.pathPrefix())) {
                return limiter;
            }
        }
        return null;
    }

    private Mono<Void> reject429(ServerWebExchange exchange) {
        ServerHttpResponse response = exchange.getResponse();
        response.setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
        response.getHeaders().set("Retry-After", "1");
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        byte[] bytes = BODY_429.getBytes(StandardCharsets.UTF_8);
        DataBuffer buffer = response.bufferFactory().wrap(bytes);
        return response.writeWith(Mono.just(buffer));
    }

    @Override
    public int getOrder() {
        return FilterOrder.CONCURRENCY_LIMIT;
    }
}
