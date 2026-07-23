package com.luckystar.wallet.service;

import com.luckystar.wallet.postgres.entity.WalletOutbox;
import com.luckystar.wallet.postgres.repository.WalletOutboxRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
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
 * 也正因未加鎖，本 poller 刻意維持 {@code fixedDelay}（下一輪等上一輪跑完才起算）而非
 * {@code fixedRate}——後者在 scheduler pool > 1 時可能兩輪並跑、重複投遞同一批。
 *
 * <p><b>吞吐設計（T-090 遠端壓測 2026-07-23 後重構）</b>：舊版在 {@code for} 迴圈裡逐筆
 * {@code .get(10s)} 等 ack，是 O(N) 的循序阻塞——即使單筆 ack 5ms，100 筆也要 ~500ms，
 * 實測撐不到 ~100 events/s，遠低於中負載所需的事件吞吐。現改為兩段式：
 * <ol>
 *   <li>依 {@code createdAt} 由舊到新<b>依序呼叫 {@code send()}</b>（非阻塞，只入 producer buffer）——
 *       partition 內順序＝送出呼叫順序，idempotent producer（{@code acks=all} 下預設開啟）即使
 *       多筆 in-flight 也不重排同 key，故同一玩家事件順序不變；</li>
 *   <li>再<b>統一等所有 ack</b>——整批 ack 平行返回，整輪耗時 ≈ 最慢單筆 ack，而非 N×ack。</li>
 * </ol>
 * 搭配可調批次（{@code wallet.outbox.batch-size}，預設 500）與較短輪詢間隔
 * （{@code wallet.outbox.poll-interval-ms}，預設 200ms），投遞上限約
 * {@code batch-size / poll-interval}（500/0.2s ≈ 2,500 events/s，含 send 往返後更保守），
 * 遠高於舊版；仍不足時可再拉大 batch 或縮短間隔。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WalletOutboxPoller {

    private final WalletOutboxRepository walletOutboxRepository;
    private final KafkaTemplate<String, String> kafkaTemplate;

    /**
     * 單輪最多撈多少筆待送事件。欄位初始值（500）供無 Spring 容器的單元測試使用；
     * 執行期由 {@code @Value} 以設定覆寫。拉大可提高吞吐，但單輪交易也隨之變大、持列較久，
     * 需與資料庫負載權衡。
     */
    @Value("${wallet.outbox.batch-size:500}")
    private int batchSize = 500;

    /** 一筆待送事件與其送出後的 ack future 配對，供第二段統一等待。 */
    private record Inflight(WalletOutbox event, CompletableFuture<SendResult<String, String>> ack) {}

    @Scheduled(fixedDelayString = "${wallet.outbox.poll-interval-ms:200}")
    @Transactional(transactionManager = "postgresTransactionManager")
    public void publishPendingEvents() {
        List<WalletOutbox> pending = walletOutboxRepository.findByStatusOrderByCreatedAtAsc(
                WalletOutbox.STATUS_PENDING, PageRequest.of(0, batchSize));
        if (pending.isEmpty()) {
            return;
        }

        // 第一段：依序射出整批 send()（非阻塞），保留送出順序＝partition 內順序
        List<Inflight> inflight = new ArrayList<>(pending.size());
        for (WalletOutbox event : pending) {
            inflight.add(new Inflight(event,
                    kafkaTemplate.send(event.getTopic(), event.getKafkaKey(), event.getPayload())));
        }

        // 第二段：統一等所有 ack（平行返回，非逐筆循序阻塞），依結果標 SENT / 累加 retry
        for (Inflight item : inflight) {
            WalletOutbox event = item.event();
            try {
                // .get(10s)：等 broker 確認真正送達才標 SENT（搭配 producer 預設 acks=all）；
                // 因整批已先射出、ack 並行返回，這裡循序 get 只耗「最慢一筆」的時間
                item.ack().get(10, TimeUnit.SECONDS);
                event.setStatus(WalletOutbox.STATUS_SENT);
                event.setSentAt(LocalDateTime.now());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                event.setRetryCount(event.getRetryCount() + 1);
                log.error("Wallet outbox publish interrupted for event id={}", event.getId(), e);
                break; // 執行緒被中斷，停止等待本輪其餘 ack（已射出者維持 PENDING、下輪重送）
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
