package com.luckystar.game.kafka;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * 發布虧損返利相關 Kafka 指令/事件（ADR-002）：
 * <ul>
 *   <li>{@code wallet.credit.request}（指令）：通知 wallet-service 入帳，冪等鍵防重。</li>
 *   <li>{@code notification.push}（事件）：best-effort 推播給玩家，失敗只記 warn。</li>
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CashbackEventPublisher {

    private static final String TOPIC_CREDIT  = "wallet.credit.request";
    private static final String TOPIC_NOTIFY  = "notification.push";
    private static final String SUBTYPE       = "CASHBACK";

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;

    /**
     * 發送入帳指令（wallet.credit.request）。
     * 失敗時拋例外讓呼叫端感知，由 CashbackService 決定是否標記 FAILED。
     */
    public void publishCredit(long playerId, long amount, String idempotencyKey)
            throws JsonProcessingException {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("playerId", playerId);
        payload.put("amount", amount);
        payload.put("subType", SUBTYPE);
        payload.put("idempotencyKey", idempotencyKey);
        payload.put("referenceId", idempotencyKey);

        String json = objectMapper.writeValueAsString(payload);
        kafkaTemplate.send(TOPIC_CREDIT, String.valueOf(playerId), json);
    }

    /**
     * 推播返利通知給玩家（best-effort，失敗只記 warn）。
     *
     * @param periodType  DAILY / WEEKLY
     * @param periodStart 計算期間起始日
     * @param lossAmount  淨虧損金額
     * @param cashbackAmount 實際返還金額
     */
    public void publishNotification(long playerId, String periodType,
                                    LocalDate periodStart, long lossAmount, long cashbackAmount) {
        try {
            boolean isDaily = "DAILY".equals(periodType);
            String type    = isDaily ? "DAILY_CASHBACK" : "WEEKLY_CASHBACK";
            String title   = isDaily ? "每日返利到帳" : "每週返利到帳";
            String message = isDaily
                    ? String.format("您 %s 虧損 %,d 星幣，系統已返還 %,d 星幣日返利禮包，已自動入帳！",
                            periodStart, lossAmount, cashbackAmount)
                    : String.format("您上週（%s 起）虧損 %,d 星幣，系統已返還 %,d 星幣週返利禮包，已自動入帳！",
                            periodStart, lossAmount, cashbackAmount);

            Map<String, Object> extra = new LinkedHashMap<>();
            extra.put("periodType", periodType);
            extra.put("periodStart", periodStart.toString());
            extra.put("lossAmount", lossAmount);
            extra.put("cashbackAmount", cashbackAmount);

            Map<String, Object> event = new LinkedHashMap<>();
            event.put("targetPlayerId", playerId);
            event.put("type", type);
            event.put("title", title);
            event.put("message", message);
            event.put("payload", extra);

            String json = objectMapper.writeValueAsString(event);
            kafkaTemplate.send(TOPIC_NOTIFY, String.valueOf(playerId), json);
        } catch (Exception ex) {
            log.warn("[返利] 推播通知失敗（best-effort，已忽略）playerId={} periodType={}: {}",
                    playerId, periodType, ex.toString());
        }
    }
}
