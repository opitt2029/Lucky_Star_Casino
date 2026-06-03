package com.luckystar.game.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 啟用 Spring 排程（T-037）。讓 {@code RtpStatsService.scheduledRecalculate} 每小時整點執行。
 *
 * <p>抽成獨立 {@code @Configuration} 而非掛在啟動類，便於切片測試（@WebMvcTest 不載入此設定，
 * 不會在 web 層測試啟動排程器）。
 */
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
