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

    /**
     * 發布捕魚機場次彙總結果。一場（buy-in → 結算）發一筆，payout/bet 取場內子彈彙總，
     * 與 {@link #publishSlotResult} 同 topic、best-effort。
     */
    public void publishFishingResult(GameRound round, Long totalShots) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("roundId", round.getRoundId());
            payload.put("playerId", round.getPlayerId());
            payload.put("gameType", round.getGameType());
            payload.put("bet", round.getBetAmount());
            payload.put("payout", round.getWinAmount());
            payload.put("totalShots", totalShots);
            payload.put("win", round.getWinAmount() != null && round.getBetAmount() != null
                    && round.getWinAmount() > round.getBetAmount());
            payload.put("settledAt", round.getSettledAt() == null ? null : round.getSettledAt().toString());

            String json = objectMapper.writeValueAsString(payload);
            kafkaTemplate.send(TOPIC, String.valueOf(round.getPlayerId()), json);
        } catch (Exception ex) {
            log.warn("發布 game.result（fishing）失敗（best-effort，已忽略）roundId={}: {}",
                    round.getRoundId(), ex.toString());
        }
    }

    /**
     * 發布百家樂結算結果（T-035）。語意與 {@link #publishSlotResult} 一致，best-effort。
     */
    public void publishBaccaratResult(GameRound round, BaccaratOutcome outcome) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("roundId", round.getRoundId());
            payload.put("playerId", round.getPlayerId());
            payload.put("gameType", round.getGameType());
            payload.put("bet", round.getBetAmount());
            payload.put("payout", round.getWinAmount());
            payload.put("result", outcome.result().name());
            payload.put("playerScore", outcome.playerScore());
            payload.put("bankerScore", outcome.bankerScore());
            payload.put("settledAt", round.getSettledAt() == null ? null : round.getSettledAt().toString());

            String json = objectMapper.writeValueAsString(payload);
            kafkaTemplate.send(TOPIC, String.valueOf(round.getPlayerId()), json);
        } catch (Exception ex) {
            log.warn("發布 game.result（baccarat）失敗（best-effort，已忽略）roundId={}: {}",
                    round.getRoundId(), ex.toString());
        }
    }
}
