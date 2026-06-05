package com.luckystar.rank.kafka;

import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.rank.service.RankService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.support.Acknowledgment;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
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

    @InjectMocks
    WalletBalanceChangedConsumer consumer;

    @Test
    void handleWalletBalanceChanged_validEvent_updatesRankAndAcks() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        WalletBalanceChangedEvent event =
                new WalletBalanceChangedEvent(10L, 42L, 100L, 900L, 1000L, "WIN", "idem-1", null);
        when(objectMapper.readValue(VALID_JSON, WalletBalanceChangedEvent.class)).thenReturn(event);

        consumer.handleWalletBalanceChanged(VALID_JSON, ack);

        verify(rankService, times(1)).updatePlayerCoins(42L, 1000L);
        verify(ack, times(1)).acknowledge();
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
