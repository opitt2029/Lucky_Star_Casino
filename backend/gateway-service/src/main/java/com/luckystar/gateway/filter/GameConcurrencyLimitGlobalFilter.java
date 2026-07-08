package com.luckystar.gateway.filter;

import com.luckystar.gateway.config.ConcurrencyLimitProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 遊戲路徑全局併發上限（load shedding，T-090 C1）。
 *
 * <p>對 /api/v1/game/** 維護「在途請求」計數：超過上限的請求立即回 429 + Retry-After，
 * 不進入後續 JWT 驗證與轉發——被拒請求不佔用 Redis 撤銷檢查與後端資源，
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
 * </ul></p>
 */
@Component
public class GameConcurrencyLimitGlobalFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(GameConcurrencyLimitGlobalFilter.class);

    private static final String GAME_PATH_PREFIX = "/api/v1/game/";
    private static final String BODY_429 =
            "{\"success\":false,\"data\":null,\"message\":\"Server busy, please retry\"}";

    private final int maxInFlight;
    private final AtomicInteger inFlight = new AtomicInteger();

    public GameConcurrencyLimitGlobalFilter(ConcurrencyLimitProperties props) {
        this.maxInFlight = props.game().maxInFlight();
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        if (!path.startsWith(GAME_PATH_PREFIX)) {
            return chain.filter(exchange);
        }

        int current = inFlight.incrementAndGet();
        if (current > maxInFlight) {
            inFlight.decrementAndGet();
            // 只在 debug 記錄個別拒絕：飽和時 warn 會刷爆 log，總量可由 429 回應計量觀測
            log.debug("Game concurrency limit reached ({}/{}), shedding request {}",
                    current, maxInFlight, path);
            return reject429(exchange);
        }
        // doFinally 涵蓋正常完成/錯誤/取消（client 斷線）三種結束路徑，保證計數歸還
        return chain.filter(exchange)
                .doFinally(signal -> inFlight.decrementAndGet());
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
        return FilterOrder.GAME_CONCURRENCY_LIMIT;
    }
}
