package com.luckystar.rank.kafka;

import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.rank.service.RankService;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.kafka.support.Acknowledgment;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WalletBalanceChangedConsumerTest {

    private static final String VALID_JSON =
            "{\"transactionId\":10,\"playerId\":42,\"amount\":100,\"balanceBefore\":900,\"balanceAfter\":1000}";

    @Mock
    RankService rankService;

    @Mock
    ObjectMapper objectMapper;

    @Mock
    StringRedisTemplate redisTemplate;

    @InjectMocks
    WalletBalanceChangedConsumer consumer;

    /** 讓去重閘的 SETNX 回傳指定序列（第一次 true=首次消費，後續 false=重複）。 */
    private void stubDedup(Boolean first, Boolean... rest) {
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.setIfAbsent(anyString(), eq("1"), any(Duration.class))).thenReturn(first, rest);
    }

    @Test
    void handleWalletBalanceChanged_validEvent_updatesRankAndAcks() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        WalletBalanceChangedEvent event =
                new WalletBalanceChangedEvent(10L, 42L, 100L, 900L, 1000L, "WIN", "idem-1", null);
        when(objectMapper.readValue(VALID_JSON, WalletBalanceChangedEvent.class)).thenReturn(event);
        stubDedup(true);

        consumer.handleWalletBalanceChanged(VALID_JSON, ack);

        verify(rankService, times(1)).updatePlayerCoins(42L, 1000L);
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void handleWalletBalanceChanged_winSubType_accumulatesDailyWinnings() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        WalletBalanceChangedEvent event =
                new WalletBalanceChangedEvent(10L, 42L, 100L, 900L, 1000L, "WIN", "idem-1", null);
        when(objectMapper.readValue(VALID_JSON, WalletBalanceChangedEvent.class)).thenReturn(event);
        stubDedup(true);

        consumer.handleWalletBalanceChanged(VALID_JSON, ack);

        verify(rankService, times(1)).updatePlayerCoins(42L, 1000L);
        verify(rankService, times(1)).addDailyWinnings(42L, 100L);
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void handleWalletBalanceChanged_nonWinSubType_doesNotAccumulateDailyWinnings() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        WalletBalanceChangedEvent event =
                new WalletBalanceChangedEvent(10L, 42L, 100L, 900L, 1000L, "BET", "idem-1", null);
        when(objectMapper.readValue(VALID_JSON, WalletBalanceChangedEvent.class)).thenReturn(event);

        consumer.handleWalletBalanceChanged(VALID_JSON, ack);

        verify(rankService, times(1)).updatePlayerCoins(42L, 1000L);
        verify(rankService, never()).addDailyWinnings(any(), org.mockito.ArgumentMatchers.anyLong());
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void handleWalletBalanceChanged_duplicateTransactionId_accumulatesDailyWinningsOnce() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        WalletBalanceChangedEvent event =
                new WalletBalanceChangedEvent(10L, 42L, 100L, 900L, 1000L, "WIN", "idem-1", null);
        when(objectMapper.readValue(VALID_JSON, WalletBalanceChangedEvent.class)).thenReturn(event);
        // 第一次消費 SETNX=true，第二次同 transactionId SETNX=false（已存在）
        stubDedup(true, false);

        consumer.handleWalletBalanceChanged(VALID_JSON, ack);
        consumer.handleWalletBalanceChanged(VALID_JSON, ack);

        // 非冪等的日贏分只累加一次
        verify(rankService, times(1)).addDailyWinnings(42L, 100L);
        // 冪等的全服星幣兩次都執行（去重不該影響它）
        verify(rankService, times(2)).updatePlayerCoins(42L, 1000L);
        verify(ack, times(2)).acknowledge();
    }

    @Test
    void handleWalletBalanceChanged_nullTransactionId_accumulatesWithoutDedup() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        WalletBalanceChangedEvent event =
                new WalletBalanceChangedEvent(null, 42L, 100L, 900L, 1000L, "WIN", "idem-1", null);
        when(objectMapper.readValue(VALID_JSON, WalletBalanceChangedEvent.class)).thenReturn(event);

        // transactionId 為 null → 跳過去重、直接執行、不拋錯（也不碰 Redis）
        consumer.handleWalletBalanceChanged(VALID_JSON, ack);

        verify(rankService, times(1)).addDailyWinnings(42L, 100L);
        verify(redisTemplate, never()).opsForValue();
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void handleWalletBalanceChanged_differentTransactionIds_eachAccumulate() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        WalletBalanceChangedEvent first =
                new WalletBalanceChangedEvent(10L, 42L, 100L, 900L, 1000L, "WIN", "idem-1", null);
        WalletBalanceChangedEvent second =
                new WalletBalanceChangedEvent(11L, 42L, 200L, 1000L, 1200L, "WIN", "idem-2", null);
        when(objectMapper.readValue("first", WalletBalanceChangedEvent.class)).thenReturn(first);
        when(objectMapper.readValue("second", WalletBalanceChangedEvent.class)).thenReturn(second);
        // 兩個不同的 transactionId，各自都是首次消費
        stubDedup(true, true);

        consumer.handleWalletBalanceChanged("first", ack);
        consumer.handleWalletBalanceChanged("second", ack);

        // 不同 transactionId 各自累加（金額不同以資區別）
        verify(rankService, times(1)).addDailyWinnings(42L, 100L);
        verify(rankService, times(1)).addDailyWinnings(42L, 200L);
        verify(ack, times(2)).acknowledge();
    }

    @Test
    void handleWalletBalanceChanged_invalidJson_throwsAndDoesNotAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        when(objectMapper.readValue(any(String.class), eq(WalletBalanceChangedEvent.class)))
                .thenThrow(new JsonParseException(null, "bad json"));

        assertThatThrownBy(() -> consumer.handleWalletBalanceChanged("not-json", ack))
                .isInstanceOf(JsonParseException.class);

        verify(rankService, never()).updatePlayerCoins(any(), any());
        verify(ack, never()).acknowledge();
    }

    @Test
    void handleWalletBalanceChanged_missingBalanceAfter_throwsAndDoesNotAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        WalletBalanceChangedEvent event =
                new WalletBalanceChangedEvent(10L, 42L, 100L, 900L, null, "WIN", "idem-1", null);
        when(objectMapper.readValue(VALID_JSON, WalletBalanceChangedEvent.class)).thenReturn(event);

        assertThatThrownBy(() -> consumer.handleWalletBalanceChanged(VALID_JSON, ack))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("balanceAfter");

        verify(rankService, never()).updatePlayerCoins(any(), any());
        verify(ack, never()).acknowledge();
    }

    @Test
    void handleWalletBalanceChanged_rankUpdateFails_doesNotAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        WalletBalanceChangedEvent event =
                new WalletBalanceChangedEvent(10L, 42L, 100L, 900L, 1000L, "WIN", "idem-1", null);
        when(objectMapper.readValue(VALID_JSON, WalletBalanceChangedEvent.class)).thenReturn(event);
        doThrow(new RuntimeException("redis down")).when(rankService).updatePlayerCoins(42L, 1000L);

        assertThatThrownBy(() -> consumer.handleWalletBalanceChanged(VALID_JSON, ack))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("redis down");

        verify(ack, never()).acknowledge();
    }
}
