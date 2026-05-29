package com.luckystar.wallet.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.dto.CreditRequest;
import com.luckystar.wallet.service.WalletService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

/**
 * 消費 {@code wallet.credit.request} 入帳指令（ADR-002）。
 *
 * <p>流程：反序列化指令 → 組 {@link CreditRequest} → 呼叫 {@link WalletService#credit}
 * （冪等、加餘額、發 {@code wallet.credit} 事件）→ 成功才 ack。
 *
 * <p>這是 T-017 簽到入帳 / T-018 新手禮入帳能真正生效的關鍵環節：member 把入帳寫進 outbox
 * 並發出指令，由本 listener 接手實際加餘額。
 *
 * <p>⚠️ 注意：本服務**只消費 wallet.credit.request（指令）**，不消費 wallet.credit（事件）；
 * 後者是 credit() 入帳後發出的，若在此消費會形成迴圈。
 *
 * <p>錯誤處理（沿用 KafkaConsumerConfig）：JSON 格式錯誤不可重試直送 DLT；
 * 暫時性失敗（DB 斷線等）往外拋不 ack，重試耗盡後送 {@code wallet.credit.request.DLT}。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WalletCreditRequestListener {

    private final WalletService walletService;
    private final ObjectMapper objectMapper;

    @KafkaListener(topics = "wallet.credit.request", groupId = "wallet-service-group")
    public void handleCreditRequest(String message, Acknowledgment ack) throws Exception {
        log.info("Received wallet.credit.request: {}", message);

        // 格式錯誤 → 不可重試，由 DefaultErrorHandler 直送 DLT
        WalletCreditRequestEvent event = objectMapper.readValue(message, WalletCreditRequestEvent.class);

        CreditRequest request = new CreditRequest();
        request.setPlayerId(event.playerId());
        request.setAmount(event.amount());
        request.setSubType(event.subType());
        request.setIdempotencyKey(event.idempotencyKey());
        request.setReferenceId(event.referenceId());

        // 冪等由 credit() 內的 idempotencyKey 保證：Kafka 重送同一指令不會重複加錢。
        // 暫時性失敗讓例外往外拋、不 ack；重試後仍失敗才送 DLT，避免入帳指令遺失。
        walletService.credit(request);

        // 僅在成功入帳後 ack
        ack.acknowledge();
    }
}
