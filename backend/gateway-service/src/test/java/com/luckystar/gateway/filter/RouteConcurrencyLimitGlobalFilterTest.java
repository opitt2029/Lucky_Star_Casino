package com.luckystar.gateway.filter;

import com.luckystar.gateway.config.ConcurrencyLimitProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import reactor.core.Disposable;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class RouteConcurrencyLimitGlobalFilterTest {

    private static final long TARGET_MS = 100;

    private RouteConcurrencyLimitGlobalFilter filter;

    @BeforeEach
    void setUp() {
        // game/wallet 上限 = 2，方便測滿載/釋放；floor=1、ceiling=4 方便測 AIMD 夾邊界
        filter = new RouteConcurrencyLimitGlobalFilter(new ConcurrencyLimitProperties(List.of(
                new ConcurrencyLimitProperties.Route("/api/v1/game/", 2, 1, 4, TARGET_MS),
                new ConcurrencyLimitProperties.Route("/api/v1/wallet/", 2, 1, 4, TARGET_MS))));
    }

    private MockServerWebExchange gameExchange() {
        return MockServerWebExchange.from(
                MockServerHttpRequest.post("/api/v1/game/slot/spin").build());
    }

    private MockServerWebExchange walletExchange() {
        return MockServerWebExchange.from(
                MockServerHttpRequest.get("/api/v1/wallet/balance").build());
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
    void unconfiguredPath_isNotLimited() {
        // 佔滿遊戲名額後，未設定的 member 路徑不受影響
        filter.filter(gameExchange(), pendingChain()).subscribe();
        filter.filter(gameExchange(), pendingChain()).subscribe();

        AtomicInteger forwarded = new AtomicInteger();
        MockServerWebExchange member = MockServerWebExchange.from(
                MockServerHttpRequest.get("/api/v1/members/me").build());

        filter.filter(member, exchange -> {
            forwarded.incrementAndGet();
            return Mono.empty();
        }).block();

        assertThat(forwarded.get()).isEqualTo(1);
        assertThat(member.getResponse().getStatusCode()).isNotEqualTo(HttpStatus.TOO_MANY_REQUESTS);
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

    @Test
    void walletPath_hasIndependentLimit() {
        // game 佔滿不影響 wallet；wallet 自己也會滿——兩條 route 各持獨立計數
        filter.filter(gameExchange(), pendingChain()).subscribe();
        filter.filter(gameExchange(), pendingChain()).subscribe();

        AtomicInteger forwarded = new AtomicInteger();
        filter.filter(walletExchange(), exchange -> {
            forwarded.incrementAndGet();
            return Mono.empty();
        }).block();
        assertThat(forwarded.get()).isEqualTo(1);

        filter.filter(walletExchange(), pendingChain()).subscribe();
        filter.filter(walletExchange(), pendingChain()).subscribe();
        MockServerWebExchange third = walletExchange();
        filter.filter(third, pendingChain()).block();
        assertThat(third.getResponse().getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
    }

    // ---- AIMD 動態調整（T-090 C3）----

    /** 以 acquire/release 配對灌入一筆指定延遲的樣本，維持在途計數平衡 */
    private void recordSample(AdaptiveInFlightLimiter limiter, long latencyMs) {
        assertThat(limiter.tryAcquire()).isTrue();
        limiter.release(latencyMs, true);
    }

    private AdaptiveInFlightLimiter gameLimiter() {
        return filter.limiterFor("/api/v1/game/slot/spin");
    }

    @Test
    void p95OverTarget_shrinksMaxMultiplicatively() {
        // 上限 10 較看得出 ×0.8 效果
        RouteConcurrencyLimitGlobalFilter f = new RouteConcurrencyLimitGlobalFilter(
                new ConcurrencyLimitProperties(List.of(
                        new ConcurrencyLimitProperties.Route("/api/v1/game/", 10, 2, 20, TARGET_MS))));
        AdaptiveInFlightLimiter limiter = f.limiterFor("/api/v1/game/x");

        recordSample(limiter, TARGET_MS * 5);
        recordSample(limiter, TARGET_MS * 5);
        recordSample(limiter, TARGET_MS * 5);
        f.adjustLimits();

        assertThat(limiter.currentMax()).isEqualTo(8); // 10 × 0.8
    }

    @Test
    void p95UnderTarget_growsMaxAdditively() {
        AdaptiveInFlightLimiter limiter = gameLimiter();

        recordSample(limiter, 1);
        filter.adjustLimits();

        assertThat(limiter.currentMax()).isEqualTo(4); // 2 + 2
    }

    @Test
    void adjustment_isClampedByFloorAndCeiling() {
        AdaptiveInFlightLimiter limiter = gameLimiter();

        // 連續超標收緊：2 → ×0.8=1.6 取整 1，floor=1 擋住，不再往下
        recordSample(limiter, TARGET_MS * 5);
        filter.adjustLimits();
        assertThat(limiter.currentMax()).isEqualTo(1);
        recordSample(limiter, TARGET_MS * 5);
        filter.adjustLimits();
        assertThat(limiter.currentMax()).isEqualTo(1);

        // 連續達標放寬：1 → 3 → 4（ceiling）→ 4 不再往上
        recordSample(limiter, 1);
        filter.adjustLimits();
        recordSample(limiter, 1);
        filter.adjustLimits();
        recordSample(limiter, 1);
        filter.adjustLimits();
        assertThat(limiter.currentMax()).isEqualTo(4);
    }

    @Test
    void noTraffic_noAdjustment() {
        AdaptiveInFlightLimiter limiter = gameLimiter();

        filter.adjustLimits(); // 窗內無任何樣本

        assertThat(limiter.currentMax()).isEqualTo(2);
    }

    @Test
    void adjustWindow_resetsAfterEachCycle() {
        AdaptiveInFlightLimiter limiter = gameLimiter();

        // 第一窗超標收緊後，樣本應歸零：第二窗無新流量就不得再調整
        recordSample(limiter, TARGET_MS * 5);
        filter.adjustLimits();
        int afterFirst = limiter.currentMax();
        filter.adjustLimits();

        assertThat(limiter.currentMax()).isEqualTo(afterFirst);
    }

    // ---- AIMD 樣本篩選（T-090 E2）----

    /** chain 模擬下游以指定狀態碼完成回應 */
    private GatewayFilterChain respondingChain(HttpStatus status) {
        return exchange -> {
            exchange.getResponse().setStatusCode(status);
            return Mono.empty();
        };
    }

    @Test
    void okResponse_isCountedInAimdWindow() {
        // 2xx 快回應是有效樣本：延遲遠低於 target → 放寬 +2
        filter.filter(gameExchange(), respondingChain(HttpStatus.OK)).block();
        filter.adjustLimits();

        assertThat(gameLimiter().currentMax()).isEqualTo(4);
    }

    @Test
    void rateLimited429_isNotCountedInAimdWindow() {
        // admitted 後被玩家限流快拒的 429 是「卸載證據」：不得以毫秒級樣本拉低 P95
        filter.filter(gameExchange(), respondingChain(HttpStatus.TOO_MANY_REQUESTS)).block();
        filter.adjustLimits();

        assertThat(gameLimiter().currentMax()).isEqualTo(2); // 窗內無有效樣本 → 凍結
    }

    @Test
    void allFiveXxWindow_freezesLimit() {
        // CB 開路期間的毫秒級 503 若進窗，會被誤讀成「延遲達標」而放寬上限
        //（2026-07-09 輪正回饋根因）；E2 後全 5xx 窗＝無有效樣本，複用「無流量不動」語意
        filter.filter(gameExchange(), respondingChain(HttpStatus.SERVICE_UNAVAILABLE)).block();
        filter.filter(gameExchange(), respondingChain(HttpStatus.BAD_GATEWAY)).block();
        filter.filter(gameExchange(), respondingChain(HttpStatus.INTERNAL_SERVER_ERROR)).block();
        filter.adjustLimits();

        assertThat(gameLimiter().currentMax()).isEqualTo(2);
    }

    @Test
    void cancelledWithoutResponse_releasesSlotButNotCounted() {
        // client 斷線（cancel 訊號、無狀態碼）：名額必須歸還，但不算有效延遲樣本
        Disposable inFlightRequest =
                filter.filter(gameExchange(), pendingChain()).subscribe();
        inFlightRequest.dispose();
        filter.adjustLimits();

        assertThat(gameLimiter().currentMax()).isEqualTo(2); // 未被樣本影響
        AtomicInteger forwarded = new AtomicInteger();
        filter.filter(gameExchange(), exchange -> {
            forwarded.incrementAndGet();
            return Mono.empty();
        }).block();
        assertThat(forwarded.get()).isEqualTo(1); // 名額已歸還
    }

    @Test
    void shrinkBelowInFlight_doesNotCorruptCounting() {
        // 收緊到 floor=1 時已有 2 個在途：不得誤放新請求，釋放後計數要回到正確水位
        Sinks.Empty<Void> first = Sinks.empty();
        Sinks.Empty<Void> second = Sinks.empty();
        filter.filter(gameExchange(), exchange -> first.asMono()).subscribe();
        filter.filter(gameExchange(), exchange -> second.asMono()).subscribe();

        AdaptiveInFlightLimiter limiter = gameLimiter();
        // 直接灌高延遲樣本觸發收緊（在途 2 不動）
        limiter.release(TARGET_MS * 5, true); // 先借用一次 release 記樣本…
        assertThat(limiter.tryAcquire()).isTrue(); // …再補回計數，維持在途=2
        filter.adjustLimits();
        assertThat(limiter.currentMax()).isEqualTo(1);

        // 在途 2 > max 1 → 新請求被拒
        MockServerWebExchange rejected = gameExchange();
        filter.filter(rejected, pendingChain()).block();
        assertThat(rejected.getResponse().getStatusCode()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS);

        // 兩個在途都完成 → 在途 0 < max 1 → 恢復放行
        first.tryEmitEmpty();
        second.tryEmitEmpty();
        AtomicInteger forwarded = new AtomicInteger();
        filter.filter(gameExchange(), exchange -> {
            forwarded.incrementAndGet();
            return Mono.empty();
        }).block();
        assertThat(forwarded.get()).isEqualTo(1);
    }
}
