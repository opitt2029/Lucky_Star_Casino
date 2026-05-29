package com.luckystar.wallet.kafka;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * 入帳「指令」訊息，來自 Kafka topic {@code wallet.credit.request}（ADR-002）。
 *
 * <p>由 member-service（簽到、新手禮）等發布，wallet-service 消費後呼叫
 * {@code WalletService.credit(...)} 真正加餘額，再另發 {@code wallet.credit}「事件」給 rank 等下游。
 *
 * <p>{@code @JsonIgnoreProperties(ignoreUnknown = true)}：發布端 payload 可能帶額外欄位
 * （如簽到的 consecutiveDays、新手禮的 reason），這裡只取需要的欄位，其餘忽略不報錯。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record WalletCreditRequestEvent(
        Long playerId,
        Long amount,
        String subType,
        String idempotencyKey,
        String referenceId
) {}
