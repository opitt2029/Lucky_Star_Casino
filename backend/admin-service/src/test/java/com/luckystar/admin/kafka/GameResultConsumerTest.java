package com.luckystar.admin.kafka;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.admin.service.AlertRuleEngine;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.support.Acknowledgment;

@ExtendWith(MockitoExtension.class)
class GameResultConsumerTest {

    @Mock
    AlertRuleEngine alertRuleEngine;

    @Mock
    Acknowledgment ack;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private GameResultConsumer consumer() {
        return new GameResultConsumer(objectMapper, alertRuleEngine);
    }

    @Test
    void validMessage_dispatchedAndAcked() {
        String json = "{\"roundId\":\"r1\",\"playerId\":42,\"gameType\":\"SLOT\","
                + "\"bet\":10,\"payout\":99999,\"win\":true,\"settledAt\":\"now\"}";

        consumer().onMessage(json, ack);

        ArgumentCaptor<GameResultEvent> captor = ArgumentCaptor.forClass(GameResultEvent.class);
        verify(alertRuleEngine).onGameResult(captor.capture());
        org.assertj.core.api.Assertions.assertThat(captor.getValue().playerId()).isEqualTo(42L);
        org.assertj.core.api.Assertions.assertThat(captor.getValue().payout()).isEqualTo(99999L);
        verify(ack).acknowledge();
    }

    @Test
    void malformedMessage_notDispatchedButStillAcked() {
        consumer().onMessage("not-json", ack);

        verify(alertRuleEngine, never()).onGameResult(any());
        verify(ack).acknowledge();
    }
}
