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

    /** 單發判定結果（血量/傷害模型）。 */
    @Value
    @Builder
    public static class ShotResult {
        long shotSeq;
        /**
         * 是否受理。局內餘額不足時該發（含其後同批子彈）不受理、不扣注；
         * 前端據此停火並提示加值或結算。
         */
        boolean accepted;
        /** 是否命中目標魚（受理且造成傷害即為 true；血量模型下幾乎等同 accepted）。 */
        boolean hit;
        /** 本發是否暴擊（傷害 ×CRIT_MULTIPLIER）。 */
        boolean crit;
        /** 本發造成的傷害（含暴擊加成）。 */
        long damage;
        /** 本發後目標魚的剩餘血量（致命一擊/未命中目標為 0）。 */
        long hpRemaining;
        /** 是否為致命一擊（累積傷害達 HP）。 */
        boolean killed;
        /** 致命一擊時是否成功捕獲（false = 掙脫逃跑、無派彩）。 */
        boolean captured;
        /** 派彩金額（0 = 未捕獲）。 */
        long payout;
        /** 該發處理後的局內餘額。 */
        long sessionBalance;
    }
}
