package com.luckystar.game.baccarat;

import java.util.Map;

/**
 * 百家樂一局多區押注的結算結果（T-034，純資料）。
 *
 * @param result       本局贏家
 * @param totalBet     本局所有押注區的下注總額
 * @param totalPayout  本局應派彩總額（含本金返還；輸的押注區為 0、和局時莊/閒退回本金）
 * @param payoutByArea 各押注區的派彩明細（押注區 → 派彩金額）
 */
public record BaccaratSettlement(
        BaccaratResult result,
        long totalBet,
        long totalPayout,
        Map<BaccaratResult, Long> payoutByArea) {
}
