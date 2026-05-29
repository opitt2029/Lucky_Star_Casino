package com.luckystar.gateway.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 每玩家限流設定，對應 application.yml 的 rate-limit 區塊。
 */
@ConfigurationProperties(prefix = "rate-limit")
public record RateLimitProperties(Player player, Game game) {

    /** 一般 API 路徑限流參數 */
    public record Player(int replenishRate, int burstCapacity) {}

    /** /api/v1/game/** 路徑嚴格限流參數 */
    public record Game(int replenishRate, int burstCapacity) {}
}
