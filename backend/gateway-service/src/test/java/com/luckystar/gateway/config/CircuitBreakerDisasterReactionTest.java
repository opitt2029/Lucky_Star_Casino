package com.luckystar.gateway.config;

import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * T-090 E1 不可回歸約束：CB 參數調鬆（COUNT_BASED/10/5/3s/80% → TIME_BASED/10s/20/4s/90%）
 * 是為了讓 AIMD 先於 CB 介入常態飽和，但 CB 對「後端整個死掉」的災難反應不得劣化超過
 * 一個量級——災難時 TimeLimiter 6s 腰斬保證吞吐仍有每秒數筆，min-calls 20 在 ~10–15s 內
 * 必然湊滿，此測試斷言湊滿當下（全逾時樣本）CB 立即開路。
 */
@SpringBootTest
class CircuitBreakerDisasterReactionTest {

    @Autowired
    private CircuitBreakerRegistry circuitBreakerRegistry;

    /** 鎖住 E1 綁定值：漂移（如誤改回 COUNT_BASED 或 min-calls 回 5）直接紅燈 */
    @Test
    void gameAndWalletCb_bindTimeBasedWindowFromYml() {
        for (String name : new String[] {"game-service", "wallet-service"}) {
            CircuitBreakerConfig config =
                    circuitBreakerRegistry.circuitBreaker(name).getCircuitBreakerConfig();
            assertThat(config.getSlidingWindowType())
                    .as("%s sliding-window-type", name)
                    .isEqualTo(CircuitBreakerConfig.SlidingWindowType.TIME_BASED);
            assertThat(config.getSlidingWindowSize()).as("%s window size (s)", name).isEqualTo(10);
            assertThat(config.getMinimumNumberOfCalls()).as("%s min calls", name).isEqualTo(20);
            assertThat(config.getSlowCallDurationThreshold())
                    .as("%s slow-call threshold", name)
                    .isEqualTo(Duration.ofSeconds(4));
            assertThat(config.getSlowCallRateThreshold()).as("%s slow-call rate", name).isEqualTo(90f);
        }
    }

    @Test
    void downstreamAllTimeout_opensCircuitOnceMinCallsReached() {
        // 用同組設定的獨立 probe 模擬，不污染共享 registry 內的實例狀態
        CircuitBreaker probe = CircuitBreaker.of("game-service-disaster-probe",
                circuitBreakerRegistry.circuitBreaker("game-service").getCircuitBreakerConfig());

        // 災難場景：連續 20 筆呼叫全部被 TimeLimiter 以 6s 腰斬（失敗率/慢呼叫率皆 100%）
        for (int i = 0; i < 20; i++) {
            probe.onError(6, TimeUnit.SECONDS, new TimeoutException("downstream dead"));
        }

        assertThat(probe.getState()).isEqualTo(CircuitBreaker.State.OPEN);
    }
}
