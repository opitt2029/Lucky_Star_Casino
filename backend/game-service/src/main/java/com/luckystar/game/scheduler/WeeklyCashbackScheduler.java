package com.luckystar.game.scheduler;

import com.luckystar.game.service.CashbackService;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 每週虧損返利排程（每週一凌晨 00:10 Asia/Taipei 執行）。
 * 計算上週一到上週日（7 天）的淨虧損，發放週返利。
 * 錯開日返利排程 5 分鐘。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WeeklyCashbackScheduler {

    private static final ZoneId TAIPEI = ZoneId.of("Asia/Taipei");

    private final CashbackService cashbackService;

    @Scheduled(cron = "0 10 0 * * MON", zone = "Asia/Taipei")
    public void run() {
        // 今天是週一，上週一 = 今天往前推 7 天
        LocalDate today      = LocalDate.now(TAIPEI);
        LocalDate weekStart  = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                                    .minusWeeks(1);
        log.info("[週返利排程] 啟動 weekStart={}", weekStart);
        try {
            int count = cashbackService.processWeeklyCashback(weekStart);
            log.info("[週返利排程] 完成 weekStart={} credited={}", weekStart, count);
        } catch (Exception ex) {
            log.error("[週返利排程] 執行失敗 weekStart={}: {}", weekStart, ex.toString(), ex);
        }
    }
}
