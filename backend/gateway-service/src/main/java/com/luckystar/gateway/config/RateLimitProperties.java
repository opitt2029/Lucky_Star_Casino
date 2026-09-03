package com.luckystar.gateway.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 每玩家限流設定，對應 application.yml 的 rate-limit 區塊。
 */
@ConfigurationProperties(prefix = "rate-limit")
public record RateLimitProperties(Player player, Game game, Vip vip, List<String> trustedProxies) {

    /**
     * 空的 {@code trusted-proxies} 環境變數必須綁成空清單，而非「含一個空字串的清單」。
     * 此 compact constructor 把 null 正規化為空清單，讓 {@link TrustedProxyMatcher}
     * 的預設行為（完全不信任 XFF）在未設定時就成立。
     *
     * <p>{@code vip} 區塊缺席時回退成一般玩家參數（＝VIP 沒有任何特權），
     * 而不是給一組寫死的寬鬆值——設定漏掉的後果應該是「少了優待」，不是「限流被放寬」。
     * 集中在此正規化，呼叫端就不必每次判空。</p>
     */
    public RateLimitProperties {
        if (trustedProxies == null) {
            trustedProxies = List.of();
        }
        if (vip == null) {
            vip = new Vip(player.replenishRate(), player.burstCapacity(),
                    game.replenishRate(), game.burstCapacity());
        }
    }

    /** 一般 API 路徑限流參數 */
    public record Player(int replenishRate, int burstCapacity) {}

    /** /api/v1/game/** 路徑嚴格限流參數 */
    public record Game(int replenishRate, int burstCapacity) {}

    /**
     * VIP（members.vip_level = VIP）專用限流參數，一般路徑與遊戲路徑各一組。
     * 刻意仍是有限的桶而非無限放行：令牌桶的職責是防單一帳號打爆單一下游，
     * 無上限等於讓這個帳號有能力把 game-service 推進 AIMD 收緊甚至熔斷，屆時全體玩家（含 VIP 自己）一起受害。
     */
    public record Vip(int replenishRate, int burstCapacity,
                      int gameReplenishRate, int gameBurstCapacity) {}
}
