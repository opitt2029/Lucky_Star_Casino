package com.luckystar.wallet.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.Set;

/**
 * 鑽石測試帳號設定。被列入 {@code diamond.unlimited-player-ids} 的玩家視為「無限鑽石」測試帳號：
 * 鑽石換星幣（T-103）時跳過餘額檢查與實際扣款，餘額查詢（T-104）直接回傳無限值，
 * 讓測試帳號可無上限兌換星幣。
 *
 * <p>僅供測試/展示用途。預設空集合（無任何測試帳號）；可由 {@code DIAMOND_UNLIMITED_PLAYER_IDS}
 * 環境變數以逗號分隔覆寫（例：{@code 1172,1175}）。
 */
@Component
@ConfigurationProperties(prefix = "diamond")
@Getter
@Setter
public class DiamondTestAccountProperties {

    /** 對外顯示給無限鑽石帳號的固定餘額（約 10 億，UI 上等同無限）。 */
    public static final long UNLIMITED_BALANCE = 1_000_000_000L;

    /** 無限鑽石測試帳號的 player id 清單。 */
    private Set<Long> unlimitedPlayerIds = new HashSet<>();

    /** 判斷某玩家是否為無限鑽石測試帳號。 */
    public boolean isUnlimited(Long playerId) {
        return playerId != null && unlimitedPlayerIds.contains(playerId);
    }
}
