package com.luckystar.gateway.filter;

import com.luckystar.gateway.config.ConcurrencyLimitProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class GameConcurrencyLimitGlobalFilterTest {

    private GameConcurrencyLimitGlobalFilter filter;

    @BeforeEach
    void setUp() {
        // 上限 = 2，方便測滿載/釋放
        filter = new GameConcurrencyLimitGlobalFilter(
                new ConcurrencyLimitProperties(new ConcurrencyLimitProperties.Game(2)));
    }

    private MockServerWebExchange gameExchange() {
        return MockServerWebExchange.from(
                MockServerHttpRequest.post("/api/v1/game/slot/spin").build());
    }

    /** chain 永不完成——模擬「在途中」的請求，佔住一個名額 */
    private GatewayFilterChain pendingChain() {
        return exchange -> Mono.never();
    }

    @Test
    void underLimit_isForwarded() {
        AtomicInteger forwarded = new AtomicInteger();
        GatewayFilterChain chain = exchange -> {
            forwarded.incrementAndGet();
            return Mono.empty();
        };

        filter.filter(gameExchange(), chain).block();

        assertThat(forwarded.get()).isEqualTo(1);
    }

    @Test
    void overLimit_returns429WithRetryAfter_andDoesNotForward() {
        // 佔滿 2 個名額（訂閱後掛著不完成）
        filter.filter(gameExchange(), pendingChain()).subscribe();
        filter.filter(gameExchange(), pendingChain()).subscribe();

        AtomicInteger forwarded = new AtomicInteger();
        GatewayFilterChain chain = exchange -> {
            forwarded.incrementAndGet();
            return Mono.empty();
        };
        MockServerWebExchange third = gameExchange();

        filter.filter(third, chain).block();

        assertThat(third.getResponse().getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
        assertThat(third.getResponse().getHeaders().getFirst("Retry-After")).isEqualTo("1");
        assertThat(forwarded.get()).isZero();
    }

    @Test
    void completedRequest_releasesSlot() {
        // 一個掛著、一個完成——完成的名額要能被下一個請求重用
        filter.filter(gameExchange(), pendingChain()).subscribe();
        Sinks.Empty<Void> completable = Sinks.empty();
        filter.filter(gameExchange(), exchange -> completable.asMono()).subscribe();
        completable.tryEmitEmpty(); // 第二個請求完成 → 釋放名額

        AtomicInteger forwarded = new AtomicInteger();
        filter.filter(gameExchange(), exchange -> {
            forwarded.incrementAndGet();
            return Mono.empty();
        }).block();

        assertThat(forwarded.get()).isEqualTo(1);
    }

    @Test
    void erroredRequest_releasesSlot() {
        filter.filter(gameExchange(), pendingChain()).subscribe();
        // chain 出錯也必須釋放名額（doFinally 涵蓋 error 訊號）
        filter.filter(gameExchange(), exchange -> Mono.error(new RuntimeException("downstream boom")))
                .onErrorResume(e -> Mono.empty())
                .block();

        AtomicInteger forwarded = new AtomicInteger();
        filter.filter(gameExchange(), exchange -> {
            forwarded.incrementAndGet();
            return Mono.empty();
        }).block();

        assertThat(forwarded.get()).isEqualTo(1);
    }

    @Test
    void nonGamePath_isNotLimited() {
        // 佔滿遊戲名額後，錢包路徑不受影響
        filter.filter(gameExchange(), pendingChain()).subscribe();
        filter.filter(gameExchange(), pendingChain()).subscribe();

        AtomicInteger forwarded = new AtomicInteger();
        MockServerWebExchange wallet = MockServerWebExchange.from(
                MockServerHttpRequest.get("/api/v1/wallet/balance").build());

        filter.filter(wallet, exchange -> {
            forwarded.incrementAndGet();
            return Mono.empty();
        }).block();

        assertThat(forwarded.get()).isEqualTo(1);
        assertThat(wallet.getResponse().getStatusCode()).isNotEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    }

    @Test
    void rejectedRequest_doesNotLeakSlot() {
        // 第 3 個被拒後，若計數有漏（拒絕時忘了歸還先加上去的 1），釋放一個名額後仍會誤判滿載
        filter.filter(gameExchange(), pendingChain()).subscribe();
        Sinks.Empty<Void> completable = Sinks.empty();
        filter.filter(gameExchange(), exchange -> completable.asMono()).subscribe();

        filter.filter(gameExchange(), pendingChain()).block(); // 被拒（429）
        completable.tryEmitEmpty(); // 釋放一個名額

        AtomicInteger forwarded = new AtomicInteger();
        filter.filter(gameExchange(), exchange -> {
            forwarded.incrementAndGet();
            return Mono.empty();
        }).block();

        assertThat(forwarded.get()).isEqualTo(1);
    }
}
