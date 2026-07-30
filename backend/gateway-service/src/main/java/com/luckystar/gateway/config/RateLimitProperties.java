package com.luckystar.gateway.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 每玩家限流設定，對應 application.yml 的 rate-limit 區塊。
 */
@ConfigurationProperties(prefix = "rate-limit")
public record RateLimitProperties(Player player, Game game, List<String> trustedProxies) {

    /**
     * 空的 {@code trusted-proxies} 環境變數必須綁成空清單，而非「含一個空字串的清單」。
     * 此 compact constructor 把 null 正規化為空清單，讓 {@link TrustedProxyMatcher}
     * 的預設行為（完全不信任 XFF）在未設定時就成立。
     */
    public RateLimitProperties {
        if (trustedProxies == null) {
            trustedProxies = List.of();
        }
    }

    /** 一般 API 路徑限流參數 */
    public record Player(int replenishRate, int burstCapacity) {}

    /** /api/v1/game/** 路徑嚴格限流參數 */
    public record Game(int replenishRate, int burstCapacity) {}
}
