package com.luckystar.admin.kafka;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.admin.service.AlertRuleEngine;
import org.assertj.core.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.support.Acknowledgment;

@ExtendWith(MockitoExtension.class)
class WalletEventConsumerTest {

    @Mock
    AlertRuleEngine alertRuleEngine;

    @Mock
    Acknowledgment ack;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private WalletEventConsumer consumer() {
        return new WalletEventConsumer(objectMapper, alertRuleEngine);
    }

    @Test
    void validMessage_dispatchedAndAcked() {
        String json = "{\"transactionId\":1,\"playerId\":7,\"amount\":500,"
                + "\"balanceAfter\":1500,\"subType\":\"BET\",\"idempotencyKey\":\"k\",\"referenceId\":\"r\"}";

        consumer().onMessage(json, ack);

        ArgumentCaptor<WalletEvent> captor = ArgumentCaptor.forClass(WalletEvent.class);
        verify(alertRuleEngine).onWalletEvent(captor.capture());
        Assertions.assertThat(captor.getValue().playerId()).isEqualTo(7L);
        verify(ack).acknowledge();
    }

    @Test
    void malformedMessage_notDispatchedButStillAcked() {
        consumer().onMessage("{bad", ack);

        verify(alertRuleEngine, never()).onWalletEvent(any());
        verify(ack).acknowledge();
    }
}
