package com.luckystar.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.luckystar.admin.kafka.GameResultEvent;
import com.luckystar.admin.kafka.NotificationPushPublisher;
import com.luckystar.admin.kafka.WalletEvent;
import com.luckystar.admin.postgres.entity.AdminAlert;
import com.luckystar.admin.postgres.repository.AdminAlertRepository;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AlertRuleEngineTest {

    @Mock
    AdminAlertRepository alertRepository;

    @Mock
    StringRedisTemplate redisTemplate;

    @Mock
    ValueOperations<String, String> valueOps;

    @Mock
    NotificationPushPublisher notificationPushPublisher;

    private AlertRuleEngine engine() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        return new AlertRuleEngine(alertRepository, redisTemplate, notificationPushPublisher);
    }

    private GameResultEvent gameResult(Long playerId, Long payout) {
        return new GameResultEvent("round-1", playerId, "SLOT", 10L, payout, payout != null, "now");
    }

    // ── 規則① BIG_WIN 邊界 ────────────────────────────────────────────────

    @Test
    void payoutJustBelowThreshold_doesNotRaiseBigWin() {
        when(valueOps.increment("admin:betcount:1")).thenReturn(1L);

        engine().onGameResult(gameResult(1L, 49_999L));

        verify(alertRepository, never()).save(any());
    }

    @Test
    void payoutJustAboveThreshold_raisesBigWin() {
        when(valueOps.increment("admin:betcount:1")).thenReturn(1L);

        engine().onGameResult(gameResult(1L, 50_001L));

        ArgumentCaptor<AdminAlert> captor = ArgumentCaptor.forClass(AdminAlert.class);
        verify(alertRepository).save(captor.capture());
        assertThat(captor.getValue().getAlertType()).isEqualTo("BIG_WIN");
        assertThat(captor.getValue().getPlayerId()).isEqualTo(1L);
        verify(notificationPushPublisher)
                .publishAlert(isNull(), eq("BIG_WIN"), any(), any(), any());
    }

    // ── 規則② HIGH_FREQUENCY 邊界 ─────────────────────────────────────────

    @Test
    void betCountAtLimit_doesNotRaiseHighFrequency() {
        when(valueOps.increment("admin:betcount:7")).thenReturn(100L);

        engine().onGameResult(gameResult(7L, null));

        verify(alertRepository, never()).save(any());
    }

    @Test
    void betCountAboveLimit_raisesHighFrequency() {
        when(valueOps.increment("admin:betcount:7")).thenReturn(101L);

        engine().onGameResult(gameResult(7L, null));

        ArgumentCaptor<AdminAlert> captor = ArgumentCaptor.forClass(AdminAlert.class);
        verify(alertRepository).save(captor.capture());
        assertThat(captor.getValue().getAlertType()).isEqualTo("HIGH_FREQUENCY");
    }

    // ── 規則③ ABNORMAL_TRANSFER 邊界 ──────────────────────────────────────

    @Test
    void txnCountAtLimit_doesNotRaiseAbnormalTransfer() {
        when(valueOps.increment("admin:txncount:5")).thenReturn(20L);

        engine().onWalletEvent(new WalletEvent(1L, 5L, 100L, 1000L, "BET", "idem", "ref"));

        verify(alertRepository, never()).save(any());
    }

    @Test
    void txnCountAboveLimit_raisesAbnormalTransfer() {
        when(valueOps.increment("admin:txncount:5")).thenReturn(21L);

        engine().onWalletEvent(new WalletEvent(1L, 5L, 100L, 1000L, "BET", "idem", "ref"));

        ArgumentCaptor<AdminAlert> captor = ArgumentCaptor.forClass(AdminAlert.class);
        verify(alertRepository).save(captor.capture());
        assertThat(captor.getValue().getAlertType()).isEqualTo("ABNORMAL_TRANSFER");
    }

    @Test
    void firstIncrement_setsTtl() {
        when(valueOps.increment("admin:txncount:9")).thenReturn(1L);

        engine().onWalletEvent(new WalletEvent(1L, 9L, 100L, 1000L, "BET", "idem", "ref"));

        verify(redisTemplate).expire("admin:txncount:9", Duration.ofSeconds(60));
        verify(alertRepository, never()).save(any());
    }

    @Test
    void nullPlayerId_isIgnored() {
        engine().onGameResult(gameResult(null, 99_999L));
        engine().onWalletEvent(new WalletEvent(1L, null, 100L, 1000L, "BET", "idem", "ref"));

        verify(alertRepository, never()).save(any());
        verify(valueOps, never()).increment(any(String.class));
    }

    @Test
    void redisUnavailable_returnsZero_noAlert() {
        when(valueOps.increment("admin:betcount:3")).thenReturn(null);

        engine().onGameResult(gameResult(3L, 10L));

        verify(alertRepository, never()).save(any());
    }
}
