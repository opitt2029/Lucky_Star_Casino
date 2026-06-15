package com.luckystar.rank.scheduler;

import com.luckystar.rank.service.DailyRankSnapshotService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class DailyRankSnapshotScheduler {

    private final DailyRankSnapshotService dailyRankSnapshotService;

    public DailyRankSnapshotScheduler(DailyRankSnapshotService dailyRankSnapshotService) {
        this.dailyRankSnapshotService = dailyRankSnapshotService;
    }

    @Scheduled(cron = "0 0 0 * * *", zone = "Asia/Taipei")
    public void snapshotDailyBalances() {
        dailyRankSnapshotService.snapshotDailyBalances();
    }
}
