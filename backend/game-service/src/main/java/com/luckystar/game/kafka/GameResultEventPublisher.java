package com.luckystar.game.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.baccarat.BaccaratOutcome;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.slot.SlotOutcome;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * 發布 {@code game.result} 事件（T-032）。下游 notification-service 訂閱以推播結果，
 * rank-service 以同一事件維護遊戲排行榜。
 *
 * <p>採 best-effort：事件發布失敗只記錄警告，不影響玩家本局結果（下注/派彩已在 wallet 落帳、
 * 對局已寫庫）。事件僅作非同步通知與排行榜投影用途，可容忍遺失。
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
        Map<String, Object> payload = basePayload(round);
        payload.put("multiplier", outcome.multiplier());
        payload.put("win", outcome.win());
        publish(round, payload, "slot");
    }

    /**
     * 發布捕魚機場次彙總結果。一場（buy-in → 結算）發一筆，payout/bet 取場內子彈彙總。
     */
    public void publishFishingResult(GameRound round, Long totalShots) {
        Map<String, Object> payload = basePayload(round);
        payload.put("totalShots", totalShots);
        payload.put("win", round.getWinAmount() != null && round.getBetAmount() != null
                && round.getWinAmount() > round.getBetAmount());
        publish(round, payload, "fishing");
    }

    /**
     * 發布百家樂結算結果（T-035）。語意與 {@link #publishSlotResult} 一致，best-effort。
     */
    public void publishBaccaratResult(GameRound round, BaccaratOutcome outcome) {
        Map<String, Object> payload = basePayload(round);
        payload.put("result", outcome.result().name());
        payload.put("playerScore", outcome.playerScore());
        payload.put("bankerScore", outcome.bankerScore());
        payload.put("win", round.getWinAmount() != null && round.getBetAmount() != null
                && round.getWinAmount() > round.getBetAmount());
        publish(round, payload, "baccarat");
    }

    private Map<String, Object> basePayload(GameRound round) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("eventId", round.getRoundId());
        payload.put("roundId", round.getRoundId());
        payload.put("playerId", round.getPlayerId());
        payload.put("gameType", round.getGameType());
        payload.put("bet", round.getBetAmount());
        payload.put("betAmount", round.getBetAmount());
        payload.put("payout", round.getWinAmount());
        payload.put("profit", round.getWinAmount() - round.getBetAmount());
        payload.put("status", round.getStatus());
        payload.put("settledAt", round.getSettledAt() == null ? null : round.getSettledAt().toString());
        return payload;
    }

    private void publish(GameRound round, Map<String, Object> payload, String label) {
        try {
            String json = objectMapper.writeValueAsString(payload);
            kafkaTemplate.send(TOPIC, String.valueOf(round.getPlayerId()), json);
        } catch (Exception ex) {
            log.warn("發布 game.result（{}）失敗（best-effort，已忽略）roundId={}: {}",
                    label, round.getRoundId(), ex.toString());
        }
    }
}
