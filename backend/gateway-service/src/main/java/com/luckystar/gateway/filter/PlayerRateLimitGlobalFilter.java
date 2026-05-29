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
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * 每玩家滑動視窗限流 Filter，order = -50，在 JWT 驗證（-100）之後執行。
 *
 * <p>以 X-User-Id 作為 Redis key，對一般路徑和遊戲路徑套用不同的 burst 上限。
 * Redis 故障時採 fail-open 策略，讓請求通過，避免限流元件造成整體服務中斷。</p>
 */
@Component
public class PlayerRateLimitGlobalFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(PlayerRateLimitGlobalFilter.class);

    private static final String BODY_429 =
            "{\"success\":false,\"data\":null,\"message\":\"Too many requests\"}";
    private static final String GAME_PATH_PREFIX = "/api/v1/game/";

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

        // 遊戲路徑套用更嚴格的限流設定
        boolean isGamePath = path.startsWith(GAME_PATH_PREFIX);
        int burstCapacity = isGamePath ? props.game().burstCapacity() : props.player().burstCapacity();
        String redisKey = isGamePath ? "rate:game:" + userId : "rate:player:" + userId;

        return redis.opsForValue().increment(redisKey)
                .flatMap(count -> {
                    // 第一次請求：設定 1 秒 TTL 開啟計數視窗
                    Mono<Void> expireMono = Mono.empty();
                    if (count == 1L) {
                        expireMono = redis.expire(redisKey, Duration.ofSeconds(1)).then();
                    }
                    if (count > burstCapacity) {
                        return expireMono.then(reject429(exchange));
                    }
                    return expireMono.then(chain.filter(exchange));
                })
                .onErrorResume(ex -> {
                    // fail-open：Redis 故障時放行，避免限流元件造成服務中斷
                    log.warn("PlayerRateLimitGlobalFilter: Redis error, fail-open. key={}, error={}",
                            redisKey, ex.getMessage());
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
