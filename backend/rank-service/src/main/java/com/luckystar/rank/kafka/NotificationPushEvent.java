package com.luckystar.rank.kafka;

import java.util.Map;

public record NotificationPushEvent(
        Long targetPlayerId,
        String type,
        String title,
        String message,
        Map<String, Object> payload) {
}
