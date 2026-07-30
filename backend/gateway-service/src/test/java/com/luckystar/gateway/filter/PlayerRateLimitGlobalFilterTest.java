package com.luckystar.gateway.filter;

import com.luckystar.gateway.config.JwtProperties;
import com.luckystar.gateway.config.RateLimitProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link PlayerRateLimitGlobalFilter} 令牌桶契約測試。
 *
 * <p>舊版是固定視窗 INCR 計數器；本測試改為驗證：單一 Lua 腳本（一次 execute）、
 * replenishRate 不再是死設定（Test 5 回歸）、hash-tag key 格式（Test 7/8）、
 * Redis 故障 fail-open（Test 9/10）。
 */
class PlayerRateLimitGlobalFilterTest {

    private ReactiveStringRedisTemplate redis;
    private GatewayFilterChain chain;
    private PlayerRateLimitGlobalFilter filter;

    @SuppressWarnings("unchecked")
    @BeforeEach
    void setUp() {
        redis = mock(ReactiveStringRedisTemplate.class);
        chain = mock(GatewayFilterChain.class);
        when(chain.filter(any())).thenReturn(Mono.empty());

        RateLimitProperties props = new RateLimitProperties(
                new RateLimitProperties.Player(10, 20),
                new RateLimitProperties.Game(5, 10),
                List.of());
        JwtProperties jwtProps = new JwtProperties("dummy-secret",
                List.of("/api/v1/auth/", "/actuator/health"));
        filter = new PlayerRateLimitGlobalFilter(redis, props, jwtProps);
    }

    /** 讓下一次 script 執行回傳指定值（1=放行 / 0=拒絕）。 */
    private void stubScript(long ret) {
        doReturn(Flux.just(ret)).when(redis).execute(any(RedisScript.class), anyList(), anyList());
    }

    private MockServerWebExchange authed(String path, String userId) {
        return MockServerWebExchange.from(
                MockServerHttpRequest.get(path).header("X-User-Id", userId).build());
    }

    @Test
    void whitelistedPath_skipsRateLimit() {
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.post("/api/v1/auth/login").build());

        filter.filter(exchange, chain).block();

        verify(redis, never()).execute(any(RedisScript.class), anyList(), anyList());
        verify(chain).filter(exchange);
    }

    @Test
    void missingUserId_skipsRateLimit() {
        MockServerWebExchange exchange = MockServerWebExchange.from(
                MockServerHttpRequest.get("/api/v1/wallet/balance").build());

        filter.filter(exchange, chain).block();

        verify(redis, never()).execute(any(RedisScript.class), anyList(), anyList());
        verify(chain).filter(exchange);
    }

    @Test
    void scriptAllows_invokesChain() {
        stubScript(1L);
        MockServerWebExchange exchange = authed("/api/v1/wallet/balance", "42");

        filter.filter(exchange, chain).block();

        verify(chain).filter(any());
        assertThat(exchange.getResponse().getStatusCode()).isNotEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    }

    @Test
    void scriptRejects_returns429WithExactBody() {
        stubScript(0L);
        MockServerWebExchange exchange = authed("/api/v1/wallet/balance", "42");

        filter.filter(exchange, chain).block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(exchange.getResponse().getHeaders().getFirst("Retry-After")).isEqualTo("1");
        assertThat(exchange.getResponse().getBodyAsString().block())
                .isEqualTo("{\"success\":false,\"data\":null,\"message\":\"Too many requests\"}");
        verify(chain, never()).filter(any());
    }

    @Test
    @SuppressWarnings("unchecked")
    void gamePath_scriptReceivesGameRateAndCapacity() {
        stubScript(1L);
        MockServerWebExchange exchange = authed("/api/v1/game/slot/spin", "42");

        filter.filter(exchange, chain).block();

        ArgumentCaptor<List<String>> argsCaptor = ArgumentCaptor.forClass(List.class);
        verify(redis).execute(any(RedisScript.class), anyList(), argsCaptor.capture());
        List<String> args = argsCaptor.getValue();
        // ARGV[1]=replenishRate（回歸：不再是死設定）、ARGV[2]=burstCapacity
        assertThat(args.get(0)).isEqualTo("5");
        assertThat(args.get(1)).isEqualTo("10");
    }

    @Test
    @SuppressWarnings("unchecked")
    void nonGamePath_scriptReceivesPlayerRateAndCapacity() {
        stubScript(1L);
        MockServerWebExchange exchange = authed("/api/v1/wallet/balance", "42");

        filter.filter(exchange, chain).block();

        ArgumentCaptor<List<String>> argsCaptor = ArgumentCaptor.forClass(List.class);
        verify(redis).execute(any(RedisScript.class), anyList(), argsCaptor.capture());
        List<String> args = argsCaptor.getValue();
        assertThat(args.get(0)).isEqualTo("10");
        assertThat(args.get(1)).isEqualTo("20");
    }

    @Test
    @SuppressWarnings("unchecked")
    void gamePath_usesHashTaggedGameKeys() {
        stubScript(1L);
        MockServerWebExchange exchange = authed("/api/v1/game/slot/spin", "42");

        filter.filter(exchange, chain).block();

        ArgumentCaptor<List<String>> keysCaptor = ArgumentCaptor.forClass(List.class);
        verify(redis).execute(any(RedisScript.class), keysCaptor.capture(), anyList());
        assertThat(keysCaptor.getValue())
                .containsExactly("rate:game:{42}:tokens", "rate:game:{42}:ts");
    }

    @Test
    @SuppressWarnings("unchecked")
    void nonGamePath_usesHashTaggedPlayerKeys() {
        stubScript(1L);
        MockServerWebExchange exchange = authed("/api/v1/wallet/balance", "42");

        filter.filter(exchange, chain).block();

        ArgumentCaptor<List<String>> keysCaptor = ArgumentCaptor.forClass(List.class);
        verify(redis).execute(any(RedisScript.class), keysCaptor.capture(), anyList());
        assertThat(keysCaptor.getValue())
                .containsExactly("rate:player:{42}:tokens", "rate:player:{42}:ts");
    }

    @Test
    @SuppressWarnings("unchecked")
    void redisError_failOpen_allowsRequest() {
        doReturn(Flux.error(new RuntimeException("redis down")))
                .when(redis).execute(any(RedisScript.class), anyList(), anyList());
        MockServerWebExchange exchange = authed("/api/v1/wallet/balance", "42");

        filter.filter(exchange, chain).block();

        verify(chain).filter(any());
        assertThat(exchange.getResponse().getStatusCode()).isNotEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    }

    @Test
    @SuppressWarnings("unchecked")
    void redisEmptyResult_failOpen_allowsRequest() {
        doReturn(Flux.empty()).when(redis).execute(any(RedisScript.class), anyList(), anyList());
        MockServerWebExchange exchange = authed("/api/v1/wallet/balance", "42");

        filter.filter(exchange, chain).block();

        verify(chain).filter(any());
        assertThat(exchange.getResponse().getStatusCode()).isNotEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    }

    @Test
    void exactlyOneScriptExecutionPerRequest() {
        stubScript(1L);
        MockServerWebExchange exchange = authed("/api/v1/wallet/balance", "42");

        filter.filter(exchange, chain).block();

        // 回歸：舊版第二次 round-trip（EXPIRE）已被移除，每請求只執行一次腳本
        verify(redis, times(1)).execute(any(RedisScript.class), anyList(), anyList());
    }
}
