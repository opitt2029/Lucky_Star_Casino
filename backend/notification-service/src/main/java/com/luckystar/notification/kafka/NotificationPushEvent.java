package com.luckystar.notification.kafka;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Map;

/**
 * {@code notification.push} 事件契約（與 rank-service 的 producer 對齊）。
 *
 * <p>{@code targetPlayerId} 非空 → 私人推播（玩家私人佇列）；為空 → 公共廣播（{@code /topic}）。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record NotificationPushEvent(
        Long targetPlayerId,
        String type,
        String title,
        String message,
        Map<String, Object> payload) {
}
