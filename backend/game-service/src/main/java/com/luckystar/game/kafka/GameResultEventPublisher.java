package com.luckystar.game.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.slot.SlotOutcome;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * 發布 {@code game.result} 事件（T-032）。下游 notification-service 訂閱以推播結果、
 * 未來 rank/統計也可消費。
 *
 * <p>採 best-effort：事件發布失敗只記錄警告，不影響玩家本局結果（下注/派彩已在 wallet 落帳、
 * 對局已寫庫）。事件僅作非同步通知用途，可容忍遺失。
 */
@Slf4j
@Component
public class GameResultEventPublisher {

    private static final String TOPIC = "game.result";

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;

    public GameResultEventPublisher(KafkaTemplate<String, String> kafkaTemplate, ObjectMapper objectMapper) {
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
    }

    public void publishSlotResult(GameRound round, SlotOutcome outcome) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("roundId", round.getRoundId());
            payload.put("playerId", round.getPlayerId());
            payload.put("gameType", round.getGameType());
            payload.put("bet", round.getBetAmount());
            payload.put("payout", round.getWinAmount());
            payload.put("multiplier", outcome.multiplier());
            payload.put("win", outcome.win());
            payload.put("settledAt", round.getSettledAt() == null ? null : round.getSettledAt().toString());

            String json = objectMapper.writeValueAsString(payload);
            kafkaTemplate.send(TOPIC, String.valueOf(round.getPlayerId()), json);
        } catch (Exception ex) {
            log.warn("發布 game.result 失敗（best-effort，已忽略）roundId={}: {}",
                    round.getRoundId(), ex.toString());
        }
    }
}
