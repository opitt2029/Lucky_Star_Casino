package com.luckystar.admin.kafka;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * {@code game.result} 事件（只取告警偵測所需欄位；其餘忽略）。
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
