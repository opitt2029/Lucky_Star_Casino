package com.luckystar.notification.kafka;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * {@code game.result} 事件契約（與 game-service 的 {@code GameResultEventPublisher} 對齊）。
 *
 * <p>game-service 對不同遊戲（slot / fishing / baccarat）送出的欄位略有差異，故以
 * {@code @JsonIgnoreProperties(ignoreUnknown = true)} 容忍額外欄位，只取推播所需共通欄位。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GameResultEvent(
        String roundId,
        Long playerId,
        String gameType,
        Long bet,
        Long payout,
        Boolean win,
        String settledAt) {
}
