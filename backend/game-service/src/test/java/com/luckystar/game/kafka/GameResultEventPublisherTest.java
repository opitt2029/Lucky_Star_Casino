package com.luckystar.game.kafka;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.slot.SlotOutcome;
import java.time.LocalDateTime;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.kafka.core.KafkaTemplate;

/** {@link GameResultEventPublisher} 測試：正常發布與 best-effort 容錯。 */
@SuppressWarnings("unchecked")
class GameResultEventPublisherTest {

    private final KafkaTemplate<String, String> kafkaTemplate = mock(KafkaTemplate.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final GameResultEventPublisher publisher =
            new GameResultEventPublisher(kafkaTemplate, objectMapper);

    private static GameRound round() {
        GameRound r = new GameRound();
        r.setRoundId("round-1");
        r.setPlayerId(42L);
        r.setGameType("SLOT");
        r.setBetAmount(100L);
        r.setWinAmount(500L);
        r.setStatus("SETTLED");
        r.setSettledAt(LocalDateTime.now());
        return r;
    }

    private static SlotOutcome outcome() {
        return new SlotOutcome(new String[][] {{"a", "b", "c"}, {"x", "x", "x"}, {"d", "e", "f"}},
                true, 5, 500L, new int[][] {{1, 0}, {1, 1}, {1, 2}});
    }

    @Test
    @DisplayName("正常發布：送到 game.result，key 為 playerId，內容含 roundId")
    void publish_success() {
        publisher.publishSlotResult(round(), outcome());
        verify(kafkaTemplate).send(eq("game.result"), eq("42"), contains("round-1"));
    }

    @Test
    @DisplayName("best-effort：send 拋例外時不外漏（不影響本局結果）")
    void publish_swallowsErrors() {
        when(kafkaTemplate.send(anyString(), anyString(), anyString()))
                .thenThrow(new RuntimeException("broker down"));
        assertDoesNotThrow(() -> publisher.publishSlotResult(round(), outcome()));
    }
}
