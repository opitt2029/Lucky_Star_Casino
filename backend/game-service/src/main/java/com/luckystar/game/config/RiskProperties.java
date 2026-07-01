package com.luckystar.game.config;

import java.util.LinkedHashMap;
import java.util.Map;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 風控門檻設定（{@code risk.*}）。
 *
 * <p><b>global-rtp-limit 為 per-game 門檻</b>：不同遊戲的結構性莊家優勢不同，含本金 RTP
 * 的「正常水位」也不同（老虎機 ≈ 0.94、百家樂 ≈ 0.99、捕魚機依數值而定），故不能用單一門檻。
 * 門檻必須訂在「該遊戲結構性 RTP 之上」，使風控只在實際出現異常莊家虧損（玩家集體大贏）時才觸發，
 * 而非每局正常派彩都誤判超限。
 *
 * <p>歷史地雷：曾用單一 {@code global-rtp-limit: 0.95}（含本金口徑）套到所有遊戲，但百家樂含本金
 * RTP ≈ 0.99 永遠 &gt; 0.95，導致 {@code RiskControlService} 幾乎每局都判超限、把非莊結果強制改成
 * 莊家贏 —— 押閒／和的玩家近乎必輸。修法即改為 per-game 門檻（見 CHANGELOG 2026-06-25）。
 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "risk")
public class RiskProperties {

    /** 單一玩家今日淨贏上限（星幣），超過即攔截。 */
    private long playerWinLimit = 50000L;

    /** 計算全局 RTP 時使用的近 N 局樣本數。 */
    private int rtpSampleSize = 500;

    /**
     * 各遊戲的全局 RTP 上限（含本金口徑，0~? 之間的小數）。
     * key 為遊戲類型（SLOT / BACCARAT / FISHING）或 {@code default}（未列出遊戲的後備值）。
     * 例：{@code {default: 1.05, SLOT: 0.97, BACCARAT: 1.02, FISHING: 1.00}}。
     */
    private Map<String, Double> globalRtpLimit = new LinkedHashMap<>();

    /** 後備門檻：當 {@code globalRtpLimit} 既無對應遊戲也無 {@code default} 時使用。 */
    private static final double FALLBACK_LIMIT = 1.05d;

    /** {@code default} 後備鍵。 */
    private static final String DEFAULT_KEY = "default";

    /**
     * 取得指定遊戲的全局 RTP 上限：先找該遊戲（不分大小寫），再找 {@code default}，皆無則回傳後備值。
     *
     * @param gameType 遊戲類型（如 {@code BACCARAT}）
     * @return 該遊戲的全局 RTP 上限（含本金口徑）
     */
    public double globalRtpLimitFor(String gameType) {
        if (gameType != null) {
            for (Map.Entry<String, Double> e : globalRtpLimit.entrySet()) {
                if (gameType.equalsIgnoreCase(e.getKey()) && e.getValue() != null) {
                    return e.getValue();
                }
            }
        }
        for (Map.Entry<String, Double> e : globalRtpLimit.entrySet()) {
            if (DEFAULT_KEY.equalsIgnoreCase(e.getKey()) && e.getValue() != null) {
                return e.getValue();
            }
        }
        return FALLBACK_LIMIT;
    }
}
