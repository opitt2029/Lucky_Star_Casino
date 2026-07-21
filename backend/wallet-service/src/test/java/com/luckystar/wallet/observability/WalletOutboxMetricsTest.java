package com.luckystar.wallet.observability;

import com.luckystar.wallet.postgres.entity.WalletOutbox;
import com.luckystar.wallet.postgres.repository.WalletOutboxRepository;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * {@link WalletOutboxMetrics} 單元測試（藍圖 04 P5）。
 *
 * <p>用 {@link SimpleMeterRegistry}（記憶體版 registry）驗證 gauge 有註冊、值會跟著刷新，
 * 以及 DB 查詢炸掉時**不會把數字歸零**——這是本元件最重要的安全性質。
 */
@ExtendWith(MockitoExtension.class)
class WalletOutboxMetricsTest {

    @Mock
    private WalletOutboxRepository walletOutboxRepository;

    private SimpleMeterRegistry registry;
    private WalletOutboxMetrics metrics;

    @BeforeEach
    void setUp() {
        registry = new SimpleMeterRegistry();
        metrics = new WalletOutboxMetrics(walletOutboxRepository, registry);
    }

    private double gaugeValue() {
        Gauge gauge = registry.find(WalletOutboxMetrics.GAUGE_NAME).gauge();
        assertThat(gauge).as("gauge %s 應已註冊", WalletOutboxMetrics.GAUGE_NAME).isNotNull();
        return gauge.value();
    }

    @Test
    @DisplayName("註冊時即抓一次 PENDING 筆數")
    void registerGauge_readsPendingCountImmediately() {
        when(walletOutboxRepository.countByStatus(eq(WalletOutbox.STATUS_PENDING))).thenReturn(7L);

        metrics.registerGauge();

        assertThat(gaugeValue()).isEqualTo(7.0);
    }

    @Test
    @DisplayName("排程刷新後 gauge 反映新值")
    void refresh_updatesGaugeValue() {
        when(walletOutboxRepository.countByStatus(eq(WalletOutbox.STATUS_PENDING)))
                .thenReturn(0L, 42L);

        metrics.registerGauge();   // 第一次：0
        metrics.refresh();         // 第二次：42

        assertThat(gaugeValue()).isEqualTo(42.0);
    }

    @Test
    @DisplayName("查詢失敗時保留上一次的值，不歸零（歸零＝假裝積壓已解除）")
    void refresh_keepsLastValueWhenQueryFails() {
        when(walletOutboxRepository.countByStatus(eq(WalletOutbox.STATUS_PENDING)))
                .thenReturn(13L)
                .thenThrow(new RuntimeException("db down"));

        metrics.registerGauge();
        metrics.refresh();

        assertThat(gaugeValue()).isEqualTo(13.0);
    }
}
