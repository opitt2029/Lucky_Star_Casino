package com.luckystar.game.slot;

import com.luckystar.game.rng.RandomStream;
import org.springframework.stereotype.Component;

/**
 * 老虎機遊戲邏輯（T-031）。
 *
 * <p>盤面為 3 輪 x 3 列（3x3），唯一賠付線為中央橫線（row=1）三格相同。賠付倍率由命中符號決定
 * （見 {@link SlotSymbol}），派彩 = 下注 x 倍率（含本金返還）。
 *
 * <p>盤面完全由傳入的 {@link RandomStream} 決定：依「逐輪（由左到右）、每輪由上而下」的固定順序，
 * 對每一格做一次加權抽樣（{@code stream.nextInt(TOTAL_WEIGHT)} 映射到符號）。此固定順序確保
 * 相同的 {@code (serverSeed, clientSeed, nonce)} 必產出相同盤面，達成可驗證公平（Provably Fair）。
 *
 * <p>本類別無狀態，可安全共用。{@link #evaluate} 為純函式，便於對特定盤面做單元測試。
 */
@Component
public class SlotMachine {

    /** 轉輪數（盤面欄數）。 */
    public static final int REELS = 3;
    /** 每輪可見列數（盤面列數）。 */
    public static final int ROWS = 3;
    /** 賠付線所在列（中央橫線）。 */
    public static final int PAYLINE_ROW = 1;

    /**
     * 依隨機串流轉動一次老虎機。
     *
     * @param stream 確定性隨機串流（由 RNG 引擎以三元組建立）
     * @param bet    下注金額（星幣），須為正數
     * @return 本局結果
     */
    public SlotOutcome spin(RandomStream stream, long bet) {
        if (stream == null) {
            throw new IllegalArgumentException("stream 不可為 null");
        }
        if (bet <= 0) {
            throw new IllegalArgumentException("bet 必須為正數，實際為 " + bet);
        }

        SlotSymbol[][] board = new SlotSymbol[ROWS][REELS];
        // 固定抽樣順序：逐輪（col 0->2），每輪由上而下（row 0->2），確保可重算。
        for (int col = 0; col < REELS; col++) {
            for (int row = 0; row < ROWS; row++) {
                board[row][col] = SlotSymbol.fromWeightedIndex(stream.nextInt(SlotSymbol.TOTAL_WEIGHT));
            }
        }
        return evaluate(board, bet);
    }

    /**
     * 幸運值全滿保底轉動：以加權隨機選出必中符號後填滿中線，非中線格仍以 RNG 正常抽樣。
     * 符號選取保持原本的加權分布（CHERRY 最常見、SEVEN 最稀有），只保證三連必中。
     */
    public SlotOutcome spinGuaranteedWin(RandomStream stream, long bet) {
        if (stream == null) throw new IllegalArgumentException("stream 不可為 null");
        if (bet <= 0) throw new IllegalArgumentException("bet 必須為正數，實際為 " + bet);

        SlotSymbol paylineSymbol = SlotSymbol.fromWeightedIndex(stream.nextInt(SlotSymbol.TOTAL_WEIGHT));
        SlotSymbol[][] board = new SlotSymbol[ROWS][REELS];
        for (int col = 0; col < REELS; col++) {
            for (int row = 0; row < ROWS; row++) {
                board[row][col] = (row == PAYLINE_ROW)
                        ? paylineSymbol
                        : SlotSymbol.fromWeightedIndex(stream.nextInt(SlotSymbol.TOTAL_WEIGHT));
            }
        }
        return evaluate(board, bet);
    }

    /**
     * 對給定盤面評估中線輸贏（純函式）。
     *
     * @param board 3x3 符號盤面（{@code board[row][col]}）
     * @param bet   下注金額
     * @return 結果（含顯示用 emoji 盤面、倍率、派彩、命中格）
     */
    public SlotOutcome evaluate(SlotSymbol[][] board, long bet) {
        SlotSymbol first = board[PAYLINE_ROW][0];
        boolean win = first == board[PAYLINE_ROW][1] && first == board[PAYLINE_ROW][2];

        int multiplier = win ? first.lineMultiplier() : 0;
        long payout = win ? Math.multiplyExact(bet, multiplier) : 0L;
        int[][] winningCells = win
                ? new int[][] {{PAYLINE_ROW, 0}, {PAYLINE_ROW, 1}, {PAYLINE_ROW, 2}}
                : new int[0][];

        return new SlotOutcome(toDisplayGrid(board), win, multiplier, payout, winningCells);
    }

    private String[][] toDisplayGrid(SlotSymbol[][] board) {
        String[][] grid = new String[ROWS][REELS];
        for (int row = 0; row < ROWS; row++) {
            for (int col = 0; col < REELS; col++) {
                grid[row][col] = board[row][col].display();
            }
        }
        return grid;
    }
}
