package com.luckystar.wallet.observability;

import com.luckystar.wallet.postgres.entity.WalletOutbox;
import com.luckystar.wallet.postgres.repository.WalletOutboxRepository;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicLong;

/**
 * wallet Outbox 積壓觀測（藍圖 04 P5）。
 *
 * <p>把 {@code wallet_outbox} 內 PENDING 的筆數做成 Micrometer gauge
 * {@code wallet.outbox.pending}（Prometheus 名稱 {@code wallet_outbox_pending}），
 * 由 {@code /actuator/prometheus} 曝露、Prometheus 每 5 秒抓取。
 *
 * <p><b>為什麼需要</b>：P2 的 Outbox 讓事件不再靜默丟失，但若
 * {@link com.luckystar.wallet.service.WalletOutboxPoller} 卡住（Kafka 掛掉、DB 鎖住、
 * 排程執行緒被佔），事件只會默默堆在表裡——**可靠性機制本身也需要被觀測**。
 * 這個數字持續攀升＝投遞鏈路壞了，是最直接的告警訊號。
 *
 * <p><b>為什麼用「快取值 + 排程刷新」而不是讓 gauge 直接查 DB</b>：
 * Micrometer 的 gauge 回呼是在**每次 scrape 時同步執行**的。若回呼裡直接下 SQL，
 * Prometheus 每 5 秒（未來多個 scraper 就是 N 倍）就打一次 DB，而且抓取執行緒會被 DB 延遲拖住。
 * 這裡改成排程每 15 秒更新一次 {@link AtomicLong}，gauge 只讀記憶體——
 * 觀測資料頂多晚 15 秒，但完全不影響帳務資料庫。這是監控埋點的通則：
 * <b>量測不可以反過來拖垮被量測的系統</b>。
 *
 * <p>查詢失敗時**保留上一次的值**並記 warn，不歸零——歸零會讓 dashboard 顯示
 * 「積壓已解除」的假象，比沒有數字更危險。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WalletOutboxMetrics {

    /** gauge 名稱；Prometheus 會轉成 wallet_outbox_pending。 */
    static final String GAUGE_NAME = "wallet.outbox.pending";

    private final WalletOutboxRepository walletOutboxRepository;
    private final MeterRegistry meterRegistry;

    /** gauge 讀的快取值，由 {@link #refresh()} 更新。 */
    private final AtomicLong pendingCount = new AtomicLong(0L);

    @PostConstruct
    void registerGauge() {
        Gauge.builder(GAUGE_NAME, pendingCount, AtomicLong::get)
                .description("wallet_outbox 中尚未送出（PENDING）的事件筆數")
                .baseUnit("events")
                .register(meterRegistry);
        // 啟動即抓一次，避免服務剛起來時 dashboard 是誤導性的 0
        refresh();
    }

    @Scheduled(fixedDelayString = "${wallet.outbox.metrics-refresh-ms:15000}")
    void refresh() {
        try {
            pendingCount.set(walletOutboxRepository.countByStatus(WalletOutbox.STATUS_PENDING));
        } catch (Exception e) {
            // 保留舊值：查不到不等於沒有積壓
            log.warn("Failed to refresh wallet outbox pending gauge, keeping last value {}: {}",
                    pendingCount.get(), e.getMessage());
        }
    }
}
