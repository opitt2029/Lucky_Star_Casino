package com.luckystar.wallet.service;

import com.luckystar.wallet.postgres.entity.WalletOutbox;
import com.luckystar.wallet.postgres.repository.WalletOutboxRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * wallet Outbox 背景投遞器（藍圖 04 P2）：定時把 wallet_outbox 內 PENDING 的事件送往 Kafka。
 *
 * <p>直接沿用 member {@code OutboxPoller} 的做法，唯一差異是 wallet 為雙資料源：
 * {@code @Transactional} 必須指定 {@code postgresTransactionManager}（outbox 在寫端 PG），
 * 否則會落到 @Primary 的 postgres TM 沒問題、但顯式指定更清楚且防未來改動（ADR-001）。
 *
 * <p>投遞保證為 at-least-once（至少一次）：若送達後、標記 SENT 前進程崩潰，下次會重送。
 * 重複投遞由下游冪等防護——rank 消費端去重（藍圖 04 P1）、wallet 讀視圖 existsById、
 * admin 報表——各自吸收。
 *
 * <p>注意（單實例假設）：本實作未對撈出的列加鎖，多副本同時輪詢會重複送同一筆。
 * production 多副本部署時，應改用 SELECT ... FOR UPDATE SKIP LOCKED 或 ShedLock 做互斥。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WalletOutboxPoller {

    private final WalletOutboxRepository walletOutboxRepository;
    private final KafkaTemplate<String, String> kafkaTemplate;

    @Scheduled(fixedDelayString = "${wallet.outbox.poll-interval-ms:1000}")
    @Transactional(transactionManager = "postgresTransactionManager")
    public void publishPendingEvents() {
        List<WalletOutbox> pending =
                walletOutboxRepository.findTop100ByStatusOrderByCreatedAtAsc(WalletOutbox.STATUS_PENDING);
        if (pending.isEmpty()) {
            return;
        }

        for (WalletOutbox event : pending) {
            try {
                // .get(10s)：同步等待 broker 確認，真正送達才標 SENT（搭配 producer 預設 acks=all）
                kafkaTemplate.send(event.getTopic(), event.getKafkaKey(), event.getPayload())
                        .get(10, TimeUnit.SECONDS);
                event.setStatus(WalletOutbox.STATUS_SENT);
                event.setSentAt(LocalDateTime.now());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                event.setRetryCount(event.getRetryCount() + 1);
                log.error("Wallet outbox publish interrupted for event id={}", event.getId(), e);
                break; // 執行緒被中斷，停止本輪
            } catch (Exception e) {
                // 投遞失敗：保持 PENDING、累加 retry，下一輪再試
                event.setRetryCount(event.getRetryCount() + 1);
                log.error("Failed to publish wallet outbox event id={} topic={}: {}",
                        event.getId(), event.getTopic(), e.getMessage());
            }
        }
        // @Transactional 結束時，managed entity 的 status/sentAt/retryCount 變更會自動 flush
    }
}
