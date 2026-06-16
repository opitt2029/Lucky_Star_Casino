package com.luckystar.notification.kafka;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

/**
 * {@code rank.update} 事件契約（與 rank-service 的 producer 對齊，T-073）。
 *
 * <p>排行榜更新後由 rank-service 發布，notification-service 消費後廣播到 {@code /topic/rank}，
 * 讓前端免輪詢即可即時更新排行榜。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RankUpdateEvent(
        String type,
        List<Map<String, Object>> entries,
        long updatedAt) {
}
