package com.luckystar.gateway.filter;

import com.luckystar.gateway.config.JwtProperties;
import com.luckystar.gateway.config.RateLimitProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;

/**
 * 每玩家 <b>token bucket</b> 限流 Filter，order = -50，在 JWT 驗證（-100）之後執行。
 *
 * <p>以 X-User-Id 作為 Redis key，對一般路徑和遊戲路徑套用不同的 replenishRate / burstCapacity。
 * 令牌桶以「單一 Lua 腳本」實作：token 寫入與 TTL 在同一腳本內原子完成，且以呼叫端時鐘
 * 依經過時間補充令牌——因此同時修正了三個舊缺陷：
 * <ul>
 *   <li>舊版 INCR＋（僅 count==1 時）EXPIRE 是兩次往返，expire 一旦失敗 key 永無 TTL，
 *       計數只增不減 → 該玩家永久 429 且不自癒。現在 TTL 與 token 同腳本寫入，不可能脫節。</li>
 *   <li>舊版是固定視窗（非令牌桶），視窗邊界可在數毫秒內送出 2× 上限。令牌桶連續補充令牌，
 *       無視窗邊界暴衝。</li>
 *   <li>舊版只讀 {@code burstCapacity}，{@code replenishRate} 是死設定（「game 5/s」根本不存在，
 *       實際是固定每秒 10）。現在 replenishRate＝補充速率、burstCapacity＝桶容量，兩者都生效。</li>
 * </ul>
 *
 * <p>Redis 故障時採 fail-open 策略放行：真正的抗洪堤壩是 {@link RouteConcurrencyLimitGlobalFilter}
 * 的 AIMD 在途上限（純記憶體、不碰 Redis），避免限流元件把 Redis 故障放大成 gateway 全面中斷。</p>
 */
@Component
public class PlayerRateLimitGlobalFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(PlayerRateLimitGlobalFilter.class);

    private static final String BODY_429 =
            "{\"success\":false,\"data\":null,\"message\":\"Too many requests\"}";
    private static final String GAME_PATH_PREFIX = "/api/v1/game/";
    /** 唯一享有寬鬆桶的等級值；其餘（含 null、空字串、未知字串）一律走一般玩家參數。 */
    private static final String VIP_TIER = "VIP";

    /**
     * 令牌桶 Lua（改寫自 Spring Cloud Gateway 內建 request_rate_limiter.lua）。
     * KEYS[1]=tokens key、KEYS[2]=timestamp key；ARGV=rate、capacity、now（帶小數的秒）。
     * TTL 與 token 在同一腳本內以 SET ... EX 寫入 → 令牌狀態 key 不可能活得比 TTL 久。
     * 回傳 1＝放行、0＝拒絕。
     */
    private static final String TOKEN_BUCKET_LUA = """
            local tokens_key = KEYS[1]
            local ts_key     = KEYS[2]
            local rate       = tonumber(ARGV[1])
            local capacity   = tonumber(ARGV[2])
            local now        = tonumber(ARGV[3])
            local requested  = 1

            local fill_time = capacity / rate
            local ttl = math.floor(fill_time * 2)
            if ttl < 1 then ttl = 1 end

            local last_tokens = tonumber(redis.call('GET', tokens_key))
            if last_tokens == nil then last_tokens = capacity end
            local last_refreshed = tonumber(redis.call('GET', ts_key))
            if last_refreshed == nil then last_refreshed = now end

            local delta  = math.max(0, now - last_refreshed)
            local filled = math.min(capacity, last_tokens + (delta * rate))
            local allowed = filled >= requested
            local new_tokens = filled
            if allowed then new_tokens = filled - requested end

            redis.call('SET', tokens_key, new_tokens, 'EX', ttl)
            redis.call('SET', ts_key, now, 'EX', ttl)

            if allowed then return 1 else return 0 end
            """;

    private static final RedisScript<Long> TOKEN_BUCKET_SCRIPT =
            RedisScript.of(TOKEN_BUCKET_LUA, Long.class);

    private final ReactiveStringRedisTemplate redis;
    private final RateLimitProperties props;
    private final JwtProperties jwtProps;

    public PlayerRateLimitGlobalFilter(ReactiveStringRedisTemplate redis,
                                       RateLimitProperties props,
                                       JwtProperties jwtProps) {
        this.redis = redis;
        this.props = props;
        this.jwtProps = jwtProps;
    }

    @Override
    public int getOrder() {
        return FilterOrder.PLAYER_RATE_LIMIT;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();

        // 白名單路徑跳過（登入、健康檢查等）
        for (String prefix : jwtProps.whitelist()) {
            if (path.startsWith(prefix)) {
                return chain.filter(exchange);
            }
        }

        // X-User-Id 為空時跳過（JWT filter 已攔截未驗證請求；此處處理邊緣案例）
        String userId = exchange.getRequest().getHeaders().getFirst("X-User-Id");
        if (userId == null || userId.isBlank()) {
            return chain.filter(exchange);
        }

        // 遊戲路徑套用更嚴格的限流設定；replenishRate 與 burstCapacity 都要讀。
        // VIP（JWT tier claim，由 JwtAuthenticationGlobalFilter 放進 attribute）改用寬鬆桶：
        // 用 VIP_TIER.equals(...) 而非反向比對，null／空字串／未知等級全部自然落回一般參數，不需額外判空。
        boolean isGamePath = path.startsWith(GAME_PATH_PREFIX);
        boolean isVip = VIP_TIER.equals(exchange.getAttribute(JwtAuthenticationGlobalFilter.USER_TIER_ATTRIBUTE));
        int rate;
        int capacity;
        if (isVip) {
            rate = isGamePath ? props.vip().gameReplenishRate() : props.vip().replenishRate();
            capacity = isGamePath ? props.vip().gameBurstCapacity() : props.vip().burstCapacity();
        } else {
            rate = isGamePath ? props.game().replenishRate() : props.player().replenishRate();
            capacity = isGamePath ? props.game().burstCapacity() : props.player().burstCapacity();
        }

        // hash tag（大括號為 Redis 語法字面量）確保 tokens/ts 兩 key 落同一 slot，未來遷 Cluster 也不拆組。
        // key 刻意不含 tier：升降級時沿用同一個桶，只是短暫多／少幾個 token；
        // 若把 tier 編進 key，降級的玩家會立刻拿到一個全新的滿桶，等於降級當下反而不受限。
        String keyPrefix = isGamePath ? "rate:game:{" + userId + "}" : "rate:player:{" + userId + "}";
        String tokensKey = keyPrefix + ":tokens";
        String tsKey = keyPrefix + ":ts";

        // Locale.ROOT：避免某些 locale 的逗號小數點傳進 Lua 的 tonumber 變成 nil
        String now = String.format(Locale.ROOT, "%.3f", System.currentTimeMillis() / 1000.0);

        return redis.execute(TOKEN_BUCKET_SCRIPT,
                        List.of(tokensKey, tsKey),
                        List.of(String.valueOf(rate), String.valueOf(capacity), now))
                .next()                 // Flux<Long> -> Mono<Long>
                .defaultIfEmpty(1L)     // 空結果視為 fail-open（放行）
                .flatMap(allowed -> allowed == 1L
                        ? chain.filter(exchange)
                        : reject429(exchange))
                .onErrorResume(ex -> {
                    // fail-open：Redis 故障時放行，避免限流元件造成服務中斷
                    log.warn("PlayerRateLimitGlobalFilter: Redis error, fail-open. key={}, error={}",
                            tokensKey, ex.getMessage());
                    return chain.filter(exchange);
                });
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
}
