package com.luckystar.game.dto;

import lombok.Builder;
import lombok.Data;

/**
 * 老虎機下注回應（T-032）。包在 {@code ApiResponse.data} 內，欄位與前端 mockApi 的 spinSlot
 * 回傳形狀一致（roundId / game / grid / bet / multiplier / payout / winningCells / wallet），
 * 並額外帶 Provably Fair 揭露欄位（serverSeed 等），供玩家事後驗證與 T-036 公平性查詢使用。
 */
@Data
@Builder
public class SpinResponse {

    /** 本局唯一識別碼。 */
    private String roundId;

    /** 遊戲類型固定為 {@code "slot"}（前端據此切換顯示）。 */
    private String game;

    /** 3x3 盤面，{@code grid[row][col]} 為符號 emoji。 */
    private String[][] grid;

    /** 本局下注金額。 */
    private long bet;

    /** 命中倍率（未中為 0）。 */
    private int multiplier;

    /** 派彩金額（= 下注 x 倍率；未中為 0）。 */
    private long payout;

    /** 命中格座標 {@code [row, col]}，未中為空陣列。 */
    private int[][] winningCells;

    /** 結算後錢包視圖。 */
    private WalletView wallet;

    // ---- Provably Fair 揭露欄位 ----

    /** 本局揭露的 server seed（開局後即揭露，可驗證）。 */
    private String serverSeed;

    /** server seed 的承諾雜湊 {@code SHA-256(serverSeed)}。 */
    private String serverSeedHash;

    /** 本局使用的 client seed。 */
    private String clientSeed;

    /** 本局 nonce。 */
    private long nonce;

    /** 本局是否由幸運值保底觸發（前端據此顯示「幸運保底觸發！」橫幅）。 */
    private boolean guaranteed;
}
