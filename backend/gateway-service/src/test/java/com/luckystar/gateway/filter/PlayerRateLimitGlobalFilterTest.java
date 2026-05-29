package com.luckystar.gateway.filter;

import com.luckystar.gateway.config.JwtProperties;
import com.luckystar.gateway.config.RateLimitProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PlayerRateLimitGlobalFilterTest {

    private ReactiveStringRedisTemplate redis;
    private ReactiveValueOperations<String, String> valueOps;
    private GatewayFilterChain chain;
    private PlayerRateLimitGlobalFilter filter;

    @SuppressWarnings("unchecked")
    @BeforeEach
    void setUp() {
        redis = mock(ReactiveStringRedisTemplate.class);
        valueOps = mock(ReactiveValueOperations.class);
        chain = mock(GatewayFilterChain.class);

        when(redis.opsForValue()).thenReturn(valueOps);
        when(chain.filter(any())).thenReturn(Mono.empty());

        RateLimitProperties props = new RateLimitProperties(
                new RateLimitProperties.Player(10, 20),
                new RateLimitProperties.Game(5, 10)
        );
        JwtProperties jwtProps = new JwtProperties("dummy-secret",
                List.of("/api/v1/auth/", "/actuator/health"));
        filter = new PlayerRateLimitGlobalFilter(redis, props, jwtProps);
    }

    @Test
    void whitelistedPath_skipsRateLimit() {
        MockServerHttpRequest request = MockServerHttpRequest
                .post("/api/v1/auth/login")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        verify(redis, never()).opsForValue();
        verify(chain).filter(exchange);
    }

    @Test
    void normalPath_firstRequest_allows() {
        when(valueOps.increment("rate:player:42")).thenReturn(Mono.just(1L));
        when(redis.expire(eq("rate:player:42"), eq(Duration.ofSeconds(1)))).thenReturn(Mono.just(true));

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/wallet/balance")
                .header("X-User-Id", "42")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        verify(chain).filter(any());
        verify(redis).expire(eq("rate:player:42"), eq(Duration.ofSeconds(1)));
    }

    @Test
    void normalPath_withinBurst_allows() {
        when(valueOps.increment("rate:player:42")).thenReturn(Mono.just(20L));

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/wallet/balance")
                .header("X-User-Id", "42")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        verify(chain).filter(any());
        verify(redis, never()).expire(anyString(), any(Duration.class));
    }

    @Test
    void normalPath_exceedsBurst_returns429() {
        when(valueOps.increment("rate:player:42")).thenReturn(Mono.just(21L));

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/wallet/balance")
                .header("X-User-Id", "42")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(exchange.getResponse().getHeaders().getFirst("Retry-After")).isEqualTo("1");
        verify(chain, never()).filter(any());
    }

    @Test
    void gamePath_stricterLimit_exceedsBurst_returns429() {
        when(valueOps.increment("rate:game:42")).thenReturn(Mono.just(11L));

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/game/bet")
                .header("X-User-Id", "42")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        verify(chain, never()).filter(any());
    }

    @Test
    void gamePath_withinStrictLimit_allows() {
        when(valueOps.increment("rate:game:42")).thenReturn(Mono.just(5L));

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/game/bet")
                .header("X-User-Id", "42")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        verify(chain).filter(any());
    }

    @Test
    void redisError_failOpen_allowsRequest() {
        when(valueOps.increment(anyString()))
                .thenReturn(Mono.error(new RuntimeException("redis down")));

        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/wallet/balance")
                .header("X-User-Id", "42")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        verify(chain).filter(any());
    }

    @Test
    void missingUserId_skipsRateLimit() {
        MockServerHttpRequest request = MockServerHttpRequest
                .get("/api/v1/wallet/balance")
                .build();
        MockServerWebExchange exchange = MockServerWebExchange.from(request);

        filter.filter(exchange, chain).block();

        verify(redis, never()).opsForValue();
        verify(chain).filter(exchange);
    }
}
