package com.luckystar.gateway.filter;

import com.luckystar.gateway.config.JwtProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Gateway 全域 JWT 驗證：
 *
 *  1. 白名單路徑直通（登入、註冊、actuator）
 *  2. 抽 Authorization: Bearer <token>，缺則 401
 *  3. 驗 JWS 簽章 + exp；失敗則 401
 *  4. 查 Redis 黑名單（key: jwt:blacklist:{jti}）；命中則 401
 *  5. 查 Redis 使用者級封鎖（key: disabled:player:{sub}，後台 T-051 停用玩家）；命中則 401
 *  6. 查 Redis 簽發時間下限（key: token:min-iat:{sub}）；token 的 iat 早於此值則 401——
 *     用於讓「停用前簽發」的舊 token 在啟用後不會復活（停用時寫入、啟用不刪、靠 TTL 清除）
 *  7. 將 sub、role 透過 X-User-Id / X-User-Role header 轉發給下游
 */
@Component
public class JwtAuthenticationGlobalFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(JwtAuthenticationGlobalFilter.class);
    private static final String BEARER_PREFIX = "Bearer ";
    private static final String BLACKLIST_KEY_PREFIX = "jwt:blacklist:";
    private static final String DISABLED_PLAYER_KEY_PREFIX = "disabled:player:";
    private static final String TOKEN_MIN_IAT_KEY_PREFIX = "token:min-iat:";
    private static final String USER_ID_HEADER = "X-User-Id";
    private static final String USER_ROLE_HEADER = "X-User-Role";
    private static final String ADMIN_PATH_PREFIX = "/admin/";
    private static final String ADMIN_ROLE = "ADMIN";
    // Redis 撤銷檢查的瞬時錯誤重試：1 次、退避 50ms 起（T-090 C2）。只吸收尖峰抖動，
    // 不改變 fail-closed 語意——重試耗盡後仍拒絕請求
    private static final long REDIS_RETRY_MAX_ATTEMPTS = 1;
    private static final Duration REDIS_RETRY_MIN_BACKOFF = Duration.ofMillis(50);

    private final JwtProperties props;
    private final SecretKey signingKey;
    private final ReactiveStringRedisTemplate redis;

    public JwtAuthenticationGlobalFilter(JwtProperties props, ReactiveStringRedisTemplate redis) {
        this.props = props;
        this.signingKey = Keys.hmacShaKeyFor(props.secret().getBytes(StandardCharsets.UTF_8));
        this.redis = redis;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getPath();

        if (isWhitelisted(path)) {
            // 白名單路徑無經驗證的身份，剝除用戶端可能偽造的身份 header 再放行
            ServerHttpRequest stripped = exchange.getRequest().mutate()
                    .headers(h -> {
                        h.remove(USER_ID_HEADER);
                        h.remove(USER_ROLE_HEADER);
                    })
                    .build();
            return chain.filter(exchange.mutate().request(stripped).build());
        }

        String authHeader = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (authHeader == null || !authHeader.startsWith(BEARER_PREFIX)) {
            return unauthorized(exchange, "missing bearer token");
        }
        String token = authHeader.substring(BEARER_PREFIX.length());

        Claims claims;
        try {
            claims = Jwts.parser()
                    .verifyWith(signingKey)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
        } catch (JwtException | IllegalArgumentException e) {
            log.debug("JWT validation failed: {}", e.getMessage());
            return unauthorized(exchange, "invalid token");
        }

        String jti = claims.getId();
        String userId = claims.getSubject();
        Object role = claims.get("role");
        // token 簽發時間（epoch 秒）；用於比對 token:min-iat 封鎖門檻
        long iatSeconds = claims.getIssuedAt() == null ? 0L : claims.getIssuedAt().toInstant().getEpochSecond();

        Mono<Boolean> blacklistCheck = (jti == null)
                ? Mono.just(Boolean.FALSE)
                : redis.hasKey(BLACKLIST_KEY_PREFIX + jti);
        // 使用者級封鎖（後台停用玩家）：admin 寫 disabled:player:{sub}，命中即令該玩家既有 token 失效
        Mono<Boolean> disabledCheck = (userId == null)
                ? Mono.just(Boolean.FALSE)
                : redis.hasKey(DISABLED_PLAYER_KEY_PREFIX + userId);
        // 簽發時間下限：token 的 iat 早於 token:min-iat:{sub} 則視為已撤銷（停用前簽發的舊 token，
        // 啟用後也不復活）。key 不存在 → 不限制。
        Mono<Boolean> minIatCheck = (userId == null)
                ? Mono.just(Boolean.FALSE)
                : redis.opsForValue().get(TOKEN_MIN_IAT_KEY_PREFIX + userId)
                        .map(v -> {
                            try {
                                return iatSeconds < Long.parseLong(v.trim());
                            } catch (NumberFormatException e) {
                                return Boolean.FALSE;
                            }
                        })
                        .defaultIfEmpty(Boolean.FALSE);

        return Mono.zip(blacklistCheck, disabledCheck, minIatCheck)
                .map(checks -> checks.getT1() || checks.getT2() || checks.getT3())
                // Redis 瞬時錯誤（尖峰逾時/連線抖動）先做 1 次短退避重試，重試＝重新訂閱、三項檢查全部重查，
                // 不會拿到殘缺結果；重試仍失敗才落入下方 fail-closed
                .retryWhen(Retry.backoff(REDIS_RETRY_MAX_ATTEMPTS, REDIS_RETRY_MIN_BACKOFF)
                        .doBeforeRetry(signal -> log.debug("Redis revocation check retrying: {}",
                                signal.failure().getMessage())))
                // Redis 故障 → fail-closed：拒絕請求而非放行，避免黑名單/封鎖失效導致已撤銷的 token 復活
                .onErrorResume(err -> {
                    // 重試耗盡時 err 是 RetryExhaustedException 包裝，取 cause 才是真正的 Redis 錯因
                    Throwable rootCause = err.getCause() != null ? err.getCause() : err;
                    log.warn("Redis revocation check failed, denying request: {}", rootCause.getMessage());
                    return Mono.just(Boolean.TRUE);
                })
                .flatMap(blocked -> {
                    if (Boolean.TRUE.equals(blocked)) {
                        return unauthorized(exchange, "token revoked or user disabled");
                    }
                    String userIdValue = userId == null ? "" : userId;
                    String roleValue = role == null ? "" : role.toString();
                    // /admin/** 需 ADMIN 角色；default-deny：role 為 null/空/非 ADMIN 一律 403
                    if (path.startsWith(ADMIN_PATH_PREFIX) && !ADMIN_ROLE.equals(roleValue)) {
                        return forbidden(exchange, "admin role required");
                    }
                    // 先 remove 再 set：避免用戶端偽造的同名 header 以重複值殘留，導致下游 getFirst() 讀到偽造值
                    ServerHttpRequest mutated = exchange.getRequest().mutate()
                            .headers(h -> {
                                h.remove(USER_ID_HEADER);
                                h.remove(USER_ROLE_HEADER);
                                h.set(USER_ID_HEADER, userIdValue);
                                h.set(USER_ROLE_HEADER, roleValue);
                            })
                            .build();
                    return chain.filter(exchange.mutate().request(mutated).build());
                });
    }

    private boolean isWhitelisted(String path) {
        for (String prefix : props.whitelist()) {
            if (path.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    private Mono<Void> forbidden(ServerWebExchange exchange, String reason) {
        exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
        exchange.getResponse().getHeaders().add("X-Auth-Error", reason);
        return exchange.getResponse().setComplete();
    }

    private Mono<Void> unauthorized(ServerWebExchange exchange, String reason) {
        exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
        exchange.getResponse().getHeaders().add("X-Auth-Error", reason);
        return exchange.getResponse().setComplete();
    }

    @Override
    public int getOrder() {
        return FilterOrder.JWT_AUTHENTICATION;
    }
}
