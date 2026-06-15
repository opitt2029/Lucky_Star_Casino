package com.luckystar.rank.scheduler;

import com.luckystar.rank.service.WeeklyRankResetService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class WeeklyRankResetScheduler {

    private final WeeklyRankResetService weeklyRankResetService;

    public WeeklyRankResetScheduler(WeeklyRankResetService weeklyRankResetService) {
        this.weeklyRankResetService = weeklyRankResetService;
    }

    @Scheduled(cron = "0 0 0 * * MON", zone = "Asia/Taipei")
    public void resetWeeklyRank() {
        weeklyRankResetService.resetWeeklyRank();
    }
}
