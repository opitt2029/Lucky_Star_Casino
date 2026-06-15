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
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MemberRegisteredConsumerTest {

    private static final String VALID_JSON =
            "{\"playerId\":42,\"username\":\"alice\",\"email\":\"alice@example.com\"}";

    @Mock
    RankService rankService;

    @Mock
    ObjectMapper objectMapper;

    @InjectMocks
    MemberRegisteredConsumer consumer;

    @Test
    void handleMemberRegistered_validEvent_cachesUsernameAndAcks() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        MemberRegisteredEvent event = new MemberRegisteredEvent(42L, "alice");
        when(objectMapper.readValue(VALID_JSON, MemberRegisteredEvent.class)).thenReturn(event);

        consumer.handleMemberRegistered(VALID_JSON, ack);

        verify(rankService).updatePlayerUsername(42L, "alice");
        verify(ack).acknowledge();
    }

    @Test
    void handleMemberRegistered_missingUsername_throwsAndDoesNotAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        MemberRegisteredEvent event = new MemberRegisteredEvent(42L, " ");
        when(objectMapper.readValue(VALID_JSON, MemberRegisteredEvent.class)).thenReturn(event);

        assertThatThrownBy(() -> consumer.handleMemberRegistered(VALID_JSON, ack))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("username");

        verify(rankService, never()).updatePlayerUsername(any(), any());
        verify(ack, never()).acknowledge();
    }

    @Test
    void handleMemberRegistered_invalidJson_throwsAndDoesNotAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        when(objectMapper.readValue(any(String.class), eq(MemberRegisteredEvent.class)))
                .thenThrow(new JsonParseException(null, "bad json"));

        assertThatThrownBy(() -> consumer.handleMemberRegistered("not-json", ack))
                .isInstanceOf(JsonParseException.class);

        verify(rankService, never()).updatePlayerUsername(any(), any());
        verify(ack, never()).acknowledge();
    }

    @Test
    void handleMemberRegistered_cacheFails_doesNotAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        MemberRegisteredEvent event = new MemberRegisteredEvent(42L, "alice");
        when(objectMapper.readValue(VALID_JSON, MemberRegisteredEvent.class)).thenReturn(event);
        doThrow(new RuntimeException("redis down"))
                .when(rankService).updatePlayerUsername(42L, "alice");

        assertThatThrownBy(() -> consumer.handleMemberRegistered(VALID_JSON, ack))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("redis down");

        verify(ack, never()).acknowledge();
    }
}
