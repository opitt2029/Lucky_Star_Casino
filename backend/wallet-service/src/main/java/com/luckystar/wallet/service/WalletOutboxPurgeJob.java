package com.luckystar.wallet.service;

import com.luckystar.wallet.postgres.entity.WalletOutbox;
import com.luckystar.wallet.postgres.repository.WalletOutboxRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * wallet_outbox 保留期清理排程。
 *
 * <p><b>為什麼需要</b>：{@link WalletOutboxPoller} 投遞成功後只把列的 status 改成 SENT，
 * <b>從不刪除</b>。而每一筆下注、派彩、贈禮都會寫一列 outbox，所以這張表是單向成長的——
 * 壓測級吞吐下會持續吃磁碟、拉長備份時間、增加 autovacuum 負擔。
 *
 * <p><b>為什麼不影響投遞效能</b>：投遞查詢走 {@code idx_wallet_outbox_status_created}
 * （{@code status} 在複合索引第一欄），撈 PENDING 時掃不到 SENT 的資料，所以膨脹本身
 * 不會讓 poller 變慢——這是「維運問題」而非「效能問題」，也是它一直沒被發現的原因。
 *
 * <p><b>為什麼不是投遞成功就立刻刪</b>：保留幾天是為了事故排查——下游（rank 排行／MySQL 讀視圖／
 * admin 報表）出現漂移時，outbox 是唯一能回答「這則事件到底有沒有發出去、何時發的」的證據。
 * 立刻刪掉等於自斷追查線索。保留期預設 7 天（{@code wallet.outbox.retention-days}），
 * 與 rank 消費端去重標記的 TTL（7 天，AGENTS.md 雷區 24）刻意取一致：兩者都對應「最大重送窗口」，
 * 保留期短於去重 TTL 會出現「事件已刪、但去重標記還在」的無法對照狀態。
 *
 * <p><b>只刪 SENT</b>：PENDING 代表尚未確認送達，無論多舊都不可刪（刪掉就是無聲丟失事件，
 * 正是 Outbox 要防的事）。若有 PENDING 長期堆積，該由 {@code WalletOutboxMetrics} 的
 * {@code wallet_outbox_pending_events} 指標告警、人工處理，不是靠清理排程掩蓋。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WalletOutboxPurgeJob {

    private final WalletOutboxRepository walletOutboxRepository;

    /** SENT 事件保留天數。欄位初始值供無 Spring 容器的單元測試使用，執行期由 {@code @Value} 覆寫。 */
    @Value("${wallet.outbox.retention-days:7}")
    private int retentionDays = 7;

    /**
     * 每日 04:00 清理保留期外的 SENT 事件。
     *
     * <p>排在離峰時段（凌晨）而非固定間隔：bulk DELETE 會持有列鎖並產生大量 WAL，
     * 與帳務熱路徑搶同一個 PostgreSQL，不該在玩家活躍時段跑。
     *
     * <p>失敗只記 log 不重試：清理是純維運工作，延一天做完全無害；拋出例外只會污染
     * scheduler 執行緒的日誌，且下次排程照樣會跑。
     */
    @Scheduled(cron = "${wallet.outbox.purge-cron:0 0 4 * * *}")
    @Transactional(transactionManager = "postgresTransactionManager")
    public void purgeSentEvents() {
        LocalDateTime before = LocalDateTime.now().minusDays(retentionDays);
        try {
            int deleted = walletOutboxRepository.deleteSentBefore(WalletOutbox.STATUS_SENT, before);
            if (deleted > 0) {
                log.info("wallet_outbox 清理完成：刪除 {} 筆 SENT 事件（sentAt < {}）", deleted, before);
            }
        } catch (Exception e) {
            log.error("wallet_outbox 清理失敗（retentionDays={}），下次排程再試: {}",
                    retentionDays, e.getMessage());
        }
    }
}
