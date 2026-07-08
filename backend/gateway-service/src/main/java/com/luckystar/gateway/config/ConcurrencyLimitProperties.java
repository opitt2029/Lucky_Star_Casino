package com.luckystar.gateway.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 遊戲路徑併發上限設定，對應 application.yml 的 concurrency-limit 區塊（T-090 C1）。
 */
@ConfigurationProperties(prefix = "concurrency-limit")
public record ConcurrencyLimitProperties(Game game) {

    /** /api/v1/game/** 路徑的全局在途請求上限 */
    public record Game(int maxInFlight) {}
}
