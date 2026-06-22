package com.luckystar.game.slot;

/**
 * 一次老虎機轉動的結果（T-031）。純資料載體，由 {@link SlotMachine} 產生。
 *
 * @param grid         3x3 盤面，{@code grid[row][col]} 為符號 emoji 字串；中央列（row=1）為賠付線
 * @param win          中線是否三連命中
 * @param multiplier   命中倍率（未中為 0）
 * @param payout       派彩金額（= 下注 x 倍率；未中為 0），含本金返還
 * @param winningCells 命中的格子座標 {@code [row, col]}，命中時為中線三格、未中為空陣列
 */
public record SlotOutcome(
        String[][] grid,
        boolean win,
        int multiplier,
        long payout,
        int[][] winningCells) {

    /** 強制未中獎結果（保留盤面顯示，派彩 = 0，無中線）。風控攔截時使用。 */
    public static SlotOutcome noWin(String[][] grid) {
        return new SlotOutcome(grid, false, 0, 0L, new int[0][]);
    }
}
