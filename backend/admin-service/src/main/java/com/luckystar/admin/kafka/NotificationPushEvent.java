package com.luckystar.admin.kafka;

import java.util.Map;

/**
 * notification.push 事件契約（比照 rank-service 版）。
 * {@code targetPlayerId == null} 表廣播給後台管理端（異常告警通知）。
 */
public record NotificationPushEvent(
        Long targetPlayerId,
        String type,
        String title,
        String message,
        Map<String, Object> payload) {
}
