package com.luckystar.member.consumer;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.member.dto.MemberRegisteredEvent;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.support.Acknowledgment;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MemberRegisteredConsumerTest {

    @Mock
    private ObjectMapper objectMapper;

    @Mock
    private Acknowledgment ack;

    @InjectMocks
    private MemberRegisteredConsumer consumer;

    private static final String VALID_MESSAGE =
            "{\"playerId\":42,\"username\":\"alice\",\"email\":\"alice@example.com\"}";

    @Test
    void onMemberRegistered_validMessage_acksWithoutAutoClaimingGift() throws Exception {
        MemberRegisteredEvent event = new MemberRegisteredEvent(42L, "alice", "alice@example.com");
        when(objectMapper.readValue(VALID_MESSAGE, MemberRegisteredEvent.class)).thenReturn(event);

        consumer.onMemberRegistered(VALID_MESSAGE, ack);

        verify(ack, times(1)).acknowledge();
    }

    @Test
    void onMemberRegistered_malformedJson_propagatesExceptionAndDoesNotAck() throws Exception {
        String badMessage = "not-valid-json";
        when(objectMapper.readValue(eq(badMessage), eq(MemberRegisteredEvent.class)))
                .thenThrow(new JsonProcessingException("Unexpected token") {});

        assertThrows(JsonProcessingException.class,
                () -> consumer.onMemberRegistered(badMessage, ack));

        verify(ack, never()).acknowledge();
    }
}