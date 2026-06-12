package com.luckystar.rank.kafka;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.rank.dto.RankEntryResponse;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class NotificationPushPublisher {

    public static final String TOPIC = "notification.push";
    public static final String WEEKLY_TOP3_TYPE = "WEEKLY_RANK_TOP3";

    private static final Logger log = LoggerFactory.getLogger(NotificationPushPublisher.class);

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;

    public NotificationPushPublisher(KafkaTemplate<String, String> kafkaTemplate, ObjectMapper objectMapper) {
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
    }

    public boolean publishWeeklyTop3Notification(
            RankEntryResponse entry,
            LocalDate weekStart,
            List<RankEntryResponse> top3) {
        try {
            NotificationPushEvent event = new NotificationPushEvent(
                    entry.playerId(),
                    WEEKLY_TOP3_TYPE,
                    "Weekly leaderboard results",
                    "You finished #" + entry.rank() + " with " + entry.score() + " coins.",
                    buildPayload(entry, weekStart, top3));
            String value = objectMapper.writeValueAsString(event);
            kafkaTemplate.send(TOPIC, entry.playerId().toString(), value);
            return true;
        } catch (JsonProcessingException ex) {
            log.warn("Failed to serialize weekly rank notification for player {}", entry.playerId(), ex);
            return false;
        } catch (RuntimeException ex) {
            log.warn("Failed to publish weekly rank notification for player {}", entry.playerId(), ex);
            return false;
        }
    }

    private Map<String, Object> buildPayload(
            RankEntryResponse entry,
            LocalDate weekStart,
            List<RankEntryResponse> top3) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("weekStart", weekStart.toString());
        payload.put("rank", entry.rank());
        payload.put("score", entry.score());
        payload.put("top3", top3.stream().map(this::toPayloadRow).toList());
        return payload;
    }

    private Map<String, Object> toPayloadRow(RankEntryResponse entry) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("playerId", entry.playerId());
        row.put("username", entry.username());
        row.put("rank", entry.rank());
        row.put("score", entry.score());
        return row;
    }
}
