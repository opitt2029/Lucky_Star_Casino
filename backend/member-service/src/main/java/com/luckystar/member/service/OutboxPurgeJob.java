package com.luckystar.member.service;

import com.luckystar.member.entity.OutboxEvent;
import com.luckystar.member.repository.OutboxEventRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * outbox_events 保留期清理排程（與 wallet 的 {@code WalletOutboxPurgeJob} 同構）。
 *
 * <p><b>為什麼需要</b>：{@link OutboxPoller} 投遞成功後只把 status 改成 SENT、<b>從不刪除</b>，
 * 這張表單向成長。member 的事件量遠低於 wallet（註冊／簽到／新手禮／好友異動，非每局觸發），
 * 膨脹速度慢得多，但成長本身沒有上界，仍該有保留期。
 *
 * <p><b>只刪 SENT</b>：PENDING 代表尚未確認送達，無論多舊都不可刪——刪掉就是無聲丟失事件，
 * 正是 Outbox 要防的事。保留期預設 7 天（{@code outbox.retention-days}），留給事故排查
 * 「這則事件到底有沒有發出去」的證據。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OutboxPurgeJob {

    private final OutboxEventRepository outboxEventRepository;

    /** SENT 事件保留天數。欄位初始值供無 Spring 容器的單元測試使用，執行期由 {@code @Value} 覆寫。 */
    @Value("${outbox.retention-days:7}")
    private int retentionDays = 7;

    /**
     * 每日 04:00 清理保留期外的 SENT 事件。排離峰時段：bulk DELETE 會產生 WAL 並持有列鎖，
     * 不該與玩家活躍時段的寫入爭搶。失敗只記 log——清理延一天無害，下次排程照樣會跑。
     */
    @Scheduled(cron = "${outbox.purge-cron:0 0 4 * * *}")
    @Transactional
    public void purgeSentEvents() {
        LocalDateTime before = LocalDateTime.now().minusDays(retentionDays);
        try {
            int deleted = outboxEventRepository.deleteSentBefore(OutboxEvent.STATUS_SENT, before);
            if (deleted > 0) {
                log.info("outbox_events 清理完成：刪除 {} 筆 SENT 事件（sentAt < {}）", deleted, before);
            }
        } catch (Exception e) {
            log.error("outbox_events 清理失敗（retentionDays={}），下次排程再試: {}",
                    retentionDays, e.getMessage());
        }
    }
}
