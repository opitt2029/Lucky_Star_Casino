package com.luckystar.admin.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.admin.dto.GmGrantRequest;
import com.luckystar.admin.dto.GmGrantResponse;
import com.luckystar.admin.postgres.entity.AdminActionLog;
import com.luckystar.admin.postgres.repository.AdminActionLogRepository;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * GM 手動發放星幣（T-055）。
 *
 * <b>ADR-002</b>：絕不直接寫 wallet —— 一律發 {@code wallet.credit.request}「指令」，
 * 由 wallet-service 冪等入帳後再發 {@code wallet.credit}「事件」給下游。
 * 每次發幣先落一筆 {@code admin_action_logs}（稽核 + 以 idempotencyKey UNIQUE 去重），
 * 再以同一把 key 當作 wallet 入帳的冪等鍵，確保重送不重複入帳。
 */
@Service
public class GmRewardService {

    public static final String TOPIC = "wallet.credit.request";
    public static final String SUBTYPE = "GM_REWARD";
    public static final String ACTION_TYPE = "GM_GRANT";

    private static final Logger log = LoggerFactory.getLogger(GmRewardService.class);

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;
    private final AdminActionLogRepository actionLogRepository;

    public GmRewardService(
            KafkaTemplate<String, String> kafkaTemplate,
            ObjectMapper objectMapper,
            AdminActionLogRepository actionLogRepository) {
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
        this.actionLogRepository = actionLogRepository;
    }

    @Transactional("postgresTransactionManager")
    public GmGrantResponse grant(String operator, GmGrantRequest req) {
        Long playerId = req.playerId();
        Long amount = req.amount();
        String idempotencyKey = "gm-grant-" + operator + "-" + playerId + "-" + UUID.randomUUID();

        // 1) 先落稽核紀錄（idempotency_key UNIQUE 去重）。
        actionLogRepository.save(new AdminActionLog(
                operator, ACTION_TYPE, playerId, amount, req.reason(), idempotencyKey));

        // 2) 發 wallet.credit.request 指令（payload 比照 member NewGiftService）。
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("playerId", playerId);
        payload.put("amount", amount);
        payload.put("subType", SUBTYPE);
        payload.put("idempotencyKey", idempotencyKey);
        payload.put("referenceId", idempotencyKey);
        payload.put("reason", req.reason());

        try {
            String value = objectMapper.writeValueAsString(payload);
            kafkaTemplate.send(TOPIC, String.valueOf(playerId), value);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("Failed to serialize wallet.credit.request payload", ex);
        }

        log.info("GM grant queued: operator={} player={} amount={} idem={}",
                operator, playerId, amount, idempotencyKey);
        return new GmGrantResponse(playerId, amount, idempotencyKey, "QUEUED");
    }
}
