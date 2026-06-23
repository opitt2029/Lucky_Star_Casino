package com.luckystar.game.scheduler;

import com.luckystar.game.service.CashbackService;
import java.time.LocalDate;
import java.time.ZoneId;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 每日虧損返利排程（每天凌晨 00:05 Asia/Taipei 執行）。
 * 錯開整點 00:00 的 RTP 統計排程，避免同時大量讀取 game_rounds。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DailyCashbackScheduler {

    private static final ZoneId TAIPEI = ZoneId.of("Asia/Taipei");

    private final CashbackService cashbackService;

    @Scheduled(cron = "0 5 0 * * *", zone = "Asia/Taipei")
    public void run() {
        LocalDate yesterday = LocalDate.now(TAIPEI).minusDays(1);
        log.info("[日返利排程] 啟動 targetDate={}", yesterday);
        try {
            int count = cashbackService.processDailyCashback(yesterday);
            log.info("[日返利排程] 完成 targetDate={} credited={}", yesterday, count);
        } catch (Exception ex) {
            log.error("[日返利排程] 執行失敗 targetDate={}: {}", yesterday, ex.toString(), ex);
        }
    }
}
