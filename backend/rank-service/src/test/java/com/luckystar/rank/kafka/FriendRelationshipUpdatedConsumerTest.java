package com.luckystar.rank.kafka;

import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.rank.service.RankService;
import java.util.List;
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
class FriendRelationshipUpdatedConsumerTest {

    private static final String VALID_JSON = "{\"playerId\":1,\"friendIds\":[2,3]}";

    @Mock
    RankService rankService;

    @Mock
    ObjectMapper objectMapper;

    @InjectMocks
    FriendRelationshipUpdatedConsumer consumer;

    @Test
    void handleFriendRelationshipUpdated_validEvent_rebuildsAndAcks() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        FriendRelationshipUpdatedEvent event = new FriendRelationshipUpdatedEvent(1L, List.of(2L, 3L));
        when(objectMapper.readValue(VALID_JSON, FriendRelationshipUpdatedEvent.class)).thenReturn(event);

        consumer.handleFriendRelationshipUpdated(VALID_JSON, ack);

        verify(rankService).rebuildFriendRank(1L, List.of(2L, 3L));
        verify(ack).acknowledge();
    }

    @Test
    void handleFriendRelationshipUpdated_missingFriendIds_throwsAndDoesNotAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        FriendRelationshipUpdatedEvent event = new FriendRelationshipUpdatedEvent(1L, null);
        when(objectMapper.readValue(VALID_JSON, FriendRelationshipUpdatedEvent.class)).thenReturn(event);

        assertThatThrownBy(() -> consumer.handleFriendRelationshipUpdated(VALID_JSON, ack))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("friendIds");

        verify(rankService, never()).rebuildFriendRank(any(), any());
        verify(ack, never()).acknowledge();
    }

    @Test
    void handleFriendRelationshipUpdated_invalidJson_throwsAndDoesNotAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        when(objectMapper.readValue(any(String.class), eq(FriendRelationshipUpdatedEvent.class)))
                .thenThrow(new JsonParseException(null, "bad json"));

        assertThatThrownBy(() -> consumer.handleFriendRelationshipUpdated("not-json", ack))
                .isInstanceOf(JsonParseException.class);

        verify(rankService, never()).rebuildFriendRank(any(), any());
        verify(ack, never()).acknowledge();
    }

    @Test
    void handleFriendRelationshipUpdated_rebuildFails_doesNotAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        FriendRelationshipUpdatedEvent event = new FriendRelationshipUpdatedEvent(1L, List.of(2L, 3L));
        when(objectMapper.readValue(VALID_JSON, FriendRelationshipUpdatedEvent.class)).thenReturn(event);
        doThrow(new RuntimeException("redis down"))
                .when(rankService).rebuildFriendRank(1L, List.of(2L, 3L));

        assertThatThrownBy(() -> consumer.handleFriendRelationshipUpdated(VALID_JSON, ack))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("redis down");

        verify(ack, never()).acknowledge();
    }
}
