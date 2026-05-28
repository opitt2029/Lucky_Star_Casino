package com.luckystar.gateway.filter;

import com.luckystar.gateway.config.JwtProperties;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class JwtAuthenticationGlobalFilterTest {

    private static final String SECRET = "0123456789-0123456789-0123456789-0123456789-secret";
    private final SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));

    private ReactiveStringRedisTemplate redis;
    private JwtAuthenticationGlobalFilter filter;

    @SuppressWarnings("unchecked")
    @BeforeEach
    void setUp() {
        redis = mock(ReactiveStringRedisTemplate.class);
        JwtProperties props = new JwtProperties(SECRET, List.of("/api/v1/auth/", "/actuator/health"));
        filter = new JwtAuthenticationGlobalFilter(props, redis);
    }

    private String token(String sub, String role, String jti, long expMillisFromNow) {
        return Jwts.builder()
                .subject(sub)
                .claim("role", role)
                .id(jti)
                .expiration(new Date(System.currentTimeMillis() + expMillisFromNow))
                .signWith(key)
                .compact();
    }

    /** 建立一個會擷取「轉發後 exchange」的 filter chain */
    private GatewayFilterChain capturingChain(AtomicReference<ServerWebExchange> captured) {
        return exchange -> {
            captured.set(exchange);
            return Mono.empty();
        };
    }

    @Test
    void authenticatedPath_forgedUserId_isOverwrittenByClaim() {
        when(redis.hasKey(anyString())).thenReturn(Mono.just(false));
        AtomicReference<ServerWebExchange> captured = new AtomicReference<>();

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/wallet/balance")
                .header("Authorization", "Bearer " + token("42", "PLAYER", "jti-1", 60_000))
                .header("X-User-Id", "999")   // 偽造
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, capturingChain(captured)).block();

        ServerHttpRequest forwarded = captured.get().getRequest();
        assertThat(forwarded.getHeaders().get("X-User-Id")).containsExactly("42");
    }

    @Test
    void authenticatedPath_forgedRole_isOverwrittenByClaim() {
        when(redis.hasKey(anyString())).thenReturn(Mono.just(false));
        AtomicReference<ServerWebExchange> captured = new AtomicReference<>();

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/wallet/balance")
                .header("Authorization", "Bearer " + token("42", "PLAYER", "jti-2", 60_000))
                .header("X-User-Role", "ADMIN")  // 偽造
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, capturingChain(captured)).block();

        ServerHttpRequest forwarded = captured.get().getRequest();
        assertThat(forwarded.getHeaders().get("X-User-Role")).containsExactly("PLAYER");
    }

    @Test
    void whitelistedPath_stripsForgedIdentityHeaders() {
        AtomicReference<ServerWebExchange> captured = new AtomicReference<>();

        MockServerHttpRequest request = MockServerHttpRequest
                .post("/api/v1/auth/login")
                .header("X-User-Id", "999")
                .header("X-User-Role", "ADMIN")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, capturingChain(captured)).block();

        ServerHttpRequest forwarded = captured.get().getRequest();
        assertThat(forwarded.getHeaders().containsKey("X-User-Id")).isFalse();
        assertThat(forwarded.getHeaders().containsKey("X-User-Role")).isFalse();
    }

    @Test
    void missingBearerToken_returns401AndDoesNotForward() {
        GatewayFilterChain chain = mock(GatewayFilterChain.class);

        MockServerHttpRequest request = MockServerHttpRequest.get("/api/v1/wallet/balance").build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        verify(chain, never()).filter(exchange);
    }

    @Test
    void invalidToken_returns401() {
        GatewayFilterChain chain = mock(GatewayFilterChain.class);

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/wallet/balance")
                .header("Authorization", "Bearer not-a-jwt")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void blacklistedJti_returns401() {
        when(redis.hasKey(anyString())).thenReturn(Mono.just(true));
        GatewayFilterChain chain = mock(GatewayFilterChain.class);

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/wallet/balance")
                .header("Authorization", "Bearer " + token("42", "PLAYER", "jti-3", 60_000))
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void redisError_failsClosedWith401() {
        when(redis.hasKey(anyString())).thenReturn(Mono.error(new RuntimeException("redis down")));
        GatewayFilterChain chain = mock(GatewayFilterChain.class);

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/wallet/balance")
                .header("Authorization", "Bearer " + token("42", "PLAYER", "jti-4", 60_000))
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    void adminPath_adminRole_isForwarded() {
        when(redis.hasKey(anyString())).thenReturn(Mono.just(false));
        AtomicReference<ServerWebExchange> captured = new AtomicReference<>();

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/admin/dashboard")
                .header("Authorization", "Bearer " + token("1", "ADMIN", "jti-a", 60_000))
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, capturingChain(captured)).block();

        assertThat(captured.get()).isNotNull();
        assertThat(captured.get().getRequest().getHeaders().get("X-User-Role")).containsExactly("ADMIN");
    }

    @Test
    void adminPath_nonAdminRole_returns403AndDoesNotForward() {
        when(redis.hasKey(anyString())).thenReturn(Mono.just(false));
        GatewayFilterChain chain = mock(GatewayFilterChain.class);

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/admin/dashboard")
                .header("Authorization", "Bearer " + token("42", "PLAYER", "jti-b", 60_000))
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(exchange.getResponse().getHeaders().getFirst("X-Auth-Error")).isEqualTo("admin role required");
        verify(chain, never()).filter(exchange);
    }

    @Test
    void adminPath_noRoleClaim_returns403() {
        when(redis.hasKey(anyString())).thenReturn(Mono.just(false));
        GatewayFilterChain chain = mock(GatewayFilterChain.class);

        // 不帶 role claim
        String noRoleToken = Jwts.builder()
                .subject("42").id("jti-c")
                .expiration(new Date(System.currentTimeMillis() + 60_000))
                .signWith(key).compact();
        MockServerHttpRequest request = MockServerHttpRequest
                .get("/admin/dashboard")
                .header("Authorization", "Bearer " + noRoleToken)
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    @Test
    void nonAdminPath_nonAdminRole_isForwarded() {
        when(redis.hasKey(anyString())).thenReturn(Mono.just(false));
        AtomicReference<ServerWebExchange> captured = new AtomicReference<>();

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/player/profile")
                .header("Authorization", "Bearer " + token("42", "PLAYER", "jti-d", 60_000))
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, capturingChain(captured)).block();

        assertThat(captured.get()).isNotNull();
        assertThat(captured.get().getRequest().getHeaders().get("X-User-Role")).containsExactly("PLAYER");
    }

    @Test
    void validToken_noForgedHeaders_forwardsClaims() {
        when(redis.hasKey(anyString())).thenReturn(Mono.just(false));
        AtomicReference<ServerWebExchange> captured = new AtomicReference<>();

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/wallet/balance")
                .header("Authorization", "Bearer " + token("7", "PLAYER", "jti-5", 60_000))
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, capturingChain(captured)).block();

        ServerHttpRequest forwarded = captured.get().getRequest();
        assertThat(forwarded.getHeaders().get("X-User-Id")).containsExactly("7");
        assertThat(forwarded.getHeaders().get("X-User-Role")).containsExactly("PLAYER");
    }
}
