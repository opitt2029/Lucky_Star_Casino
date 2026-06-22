package com.luckystar.rank.scheduler;

import com.luckystar.rank.service.RankService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class DailyWinningsResetScheduler {

    private final RankService rankService;

    public DailyWinningsResetScheduler(RankService rankService) {
        this.rankService = rankService;
    }

    @Scheduled(cron = "0 0 0 * * *", zone = "Asia/Taipei")
    public void resetDailyWinnings() {
        rankService.resetDailyWinnings();
    }
}
