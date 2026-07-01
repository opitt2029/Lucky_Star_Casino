package com.luckystar.rank.kafka;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.rank.dto.RankEntryResponse;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * 排行榜廣播發布者（T-073）：global TOP10 變動時對外發布 rank.update 事件，best-effort。
 */
@Component
public class RankUpdatePublisher {

    public static final String TOPIC = "rank.update";
    public static final String GLOBAL_TOP10_TYPE = "GLOBAL_TOP10";

    private static final Logger log = LoggerFactory.getLogger(RankUpdatePublisher.class);

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;

    public RankUpdatePublisher(KafkaTemplate<String, String> kafkaTemplate, ObjectMapper objectMapper) {
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
    }

    public boolean publishTop10(List<RankEntryResponse> top10) {
        try {
            RankUpdateEvent event = new RankUpdateEvent(
                    GLOBAL_TOP10_TYPE,
                    top10,
                    System.currentTimeMillis());
            String value = objectMapper.writeValueAsString(event);
            kafkaTemplate.send(TOPIC, GLOBAL_TOP10_TYPE, value);
            return true;
        } catch (JsonProcessingException ex) {
            log.warn("Failed to serialize rank update broadcast", ex);
            return false;
        } catch (RuntimeException ex) {
            log.warn("Failed to publish rank update broadcast", ex);
            return false;
        }
    }
}
