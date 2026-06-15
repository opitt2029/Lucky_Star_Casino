package com.luckystar.game.dto;

import java.util.List;
import lombok.Builder;
import lombok.Value;

/**
 * 捕魚機批次射擊回應：逐發判定結果 + 最新局內餘額。
 *
 * <p>前端以「預判渲染」先演出子彈飛行與命中火花，收到本回應後才播放
 * 魚死亡/逃跑與金幣派彩演出（near-miss 表現層）。
 */
@Value
@Builder
public class FishingShotsResponse {

    String sessionId;
    List<ShotResult> results;
    /** 處理完本批後的局內餘額。 */
    long sessionBalance;
    long totalShots;
    long lastShotSeq;

    /** 單發判定結果。 */
    @Value
    @Builder
    public static class ShotResult {
        long shotSeq;
        /**
         * 是否受理。局內餘額不足時該發（含其後同批子彈）不受理、不扣注；
         * 前端據此停火並提示加值或結算。
         */
        boolean accepted;
        boolean hit;
        /** 派彩金額（0 = 未命中）。 */
        long payout;
        /** 該發處理後的局內餘額。 */
        long sessionBalance;
    }
}
