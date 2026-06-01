package com.luckystar.wallet.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.mysql.entity.WalletTransactionView;
import com.luckystar.wallet.mysql.repository.WalletTransactionViewRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * Kafka → MySQL 讀端同步 listener（T-025 補資料來源）。
 *
 * <p>消費入帳/扣款「事件」，把每筆交易寫入 MySQL 讀庫 {@code wallet_transactions}
 * （由 {@link WalletTransactionViewRepository} / {@code mysqlEntityManagerFactory} 管理），
 * 讓 {@code GET /api/v1/wallet/transactions} 能回傳真實流水（CQRS 讀端，ADR-001 最終一致）。
 *
 * <p>⚠️ <b>Topic 規則（ADR-002，本碼庫頭號地雷）</b>：
 * <ul>
 *   <li>消費 {@code wallet.debit}（{@code WalletService.debit()} 發布）</li>
 *   <li>消費 {@code wallet.credit}（{@code WalletService.credit()} 發布）</li>
 *   <li><b>絕不</b>消費 {@code wallet.credit.request}（指令）——在 wallet-service 內消費會觸發
 *       再次入帳 → 再發指令 → 再入帳的無限迴圈。</li>
 * </ul>
 *
 * <p>錯誤處理（沿用 {@link com.luckystar.wallet.config.KafkaConsumerConfig}）：
 * JSON 格式錯誤不可重試，直接送 {@code <topic>.DLT}；暫時性失敗（如 DB 斷線）讓例外往外拋、
 * 不 ack，重試 3 次耗盡後送 DLT。冪等由讀庫主鍵存在性檢查保證（Kafka at-least-once 重送安全）。
 *
 * <p>每個 handler 個別標註 {@code @Transactional(transactionManager = "mysqlTransactionManager")}
 * （寫讀庫走 MySQL 交易管理器）；<b>不在類別層級標註</b>，以免干擾 Kafka listener proxy。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WalletReadSyncListener {

    private final WalletTransactionViewRepository viewRepository;
    private final ObjectMapper objectMapper;

    @KafkaListener(topics = "wallet.debit", groupId = "wallet-service-group")
    @Transactional(transactionManager = "mysqlTransactionManager")
    public void onDebit(String message, Acknowledgment ack) throws Exception {
        // 格式錯誤 → 不可重試，由 DefaultErrorHandler 直送 wallet.debit.DLT
        WalletDebitEvent event = objectMapper.readValue(message, WalletDebitEvent.class);

        // 冪等：讀庫已有同 id 即視為重送，跳過寫入但仍 ack
        if (viewRepository.existsById(event.transactionId())) {
            log.warn("Duplicate debit event id={}, skipping", event.transactionId());
            ack.acknowledge();
            return;
        }

        // 舊訊息可能無 subType（null）→ 回退為 BET（早期 debit 一律下注）
        String subType = event.subType() == null ? "BET" : event.subType();
        WalletTransactionView view = WalletTransactionView.builder()
                .id(event.transactionId())
                .playerId(event.playerId())
                .type("DEBIT")
                .subType(subType)
                .amount(event.amount())
                .balanceBefore(event.balanceBefore())
                .balanceAfter(event.balanceAfter())
                .referenceId(event.referenceId())
                .createdAt(LocalDateTime.now())
                .build();

        // save 失敗（如 DB 斷線）讓例外往外拋、不 ack；重試耗盡後送 wallet.debit.DLT
        viewRepository.save(view);
        log.info("Synced debit tx id={} playerId={}", event.transactionId(), event.playerId());

        // 僅在成功寫入後 ack
        ack.acknowledge();
    }

    @KafkaListener(topics = "wallet.credit", groupId = "wallet-service-group")
    @Transactional(transactionManager = "mysqlTransactionManager")
    public void onCredit(String message, Acknowledgment ack) throws Exception {
        // 格式錯誤 → 不可重試，由 DefaultErrorHandler 直送 wallet.credit.DLT
        WalletCreditEvent event = objectMapper.readValue(message, WalletCreditEvent.class);

        // 冪等：讀庫已有同 id 即視為重送，跳過寫入但仍 ack
        if (viewRepository.existsById(event.transactionId())) {
            log.warn("Duplicate credit event id={}, skipping", event.transactionId());
            ack.acknowledge();
            return;
        }

        WalletTransactionView view = WalletTransactionView.builder()
                .id(event.transactionId())
                .playerId(event.playerId())
                .type("CREDIT")
                .subType(event.subType())
                .amount(event.amount())
                .balanceBefore(event.balanceBefore())
                .balanceAfter(event.balanceAfter())
                .referenceId(event.referenceId())
                .createdAt(LocalDateTime.now())
                .build();

        // save 失敗（如 DB 斷線）讓例外往外拋、不 ack；重試耗盡後送 wallet.credit.DLT
        viewRepository.save(view);
        log.info("Synced credit tx id={} playerId={} subType={}",
                event.transactionId(), event.playerId(), event.subType());

        // 僅在成功寫入後 ack
        ack.acknowledge();
    }
}
