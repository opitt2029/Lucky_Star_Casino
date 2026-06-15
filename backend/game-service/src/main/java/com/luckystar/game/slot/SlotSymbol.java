package com.luckystar.game.slot;

/**
 * 老虎機符號表（T-031）。
 *
 * <p>五種符號與前端 {@code SlotMachine} 使用的 emoji 完全一致。display 字串以「整數 code point」
 * 建構（見建構子），整個原始碼維持純 ASCII，不受檔案/編譯器編碼影響，確保產出的位元組與前端
 * 逐一相符（前端據此比對並載入對應圖像，差一個位元組就會對不上）。
 *
 * <p>各符號 code point（已與 frontend/src/services/mockApi.js 的 slotSymbols 逐一核對）：
 * <ul>
 *   <li>CHERRY = U+1F352、LEMON = U+1F34B、BELL = U+1F514、STAR = U+2B50</li>
 *   <li>SEVEN  = U+0037 U+FE0F U+20E3（數字 7 + 變體選擇子 + 圍封鍵帽，共三個 code point）</li>
 * </ul>
 *
 * <p>每個符號帶兩個賠付參數：
 * <ul>
 *   <li><b>weight</b>：轉輪上出現的相對權重（越大越常見）。權重決定盤面分布，進而決定 RTP。</li>
 *   <li><b>lineMultiplier</b>：中線三連時的倍率（含本金返還，派彩 = 下注 x 倍率）。
 *       倍率取前端公告的 2x / 3x / 5x / 8x；越稀有的符號倍率越高。</li>
 * </ul>
 *
 * <p>以目前權重（總和 100）計算，單中線三連的理論 RTP 約 17.7%、命中率約 5.6%。此值偏低源於
 * 「單中線、僅三連賠付、倍率上限 8x」的既有玩法設定；權重與倍率皆為常數，可由產品端調整以
 * 校準 RTP（T-037 會實際量測）。
 */
public enum SlotSymbol {

    CHERRY(30, 2, 0x1F352),
    LEMON(26, 3, 0x1F34B),
    BELL(20, 5, 0x1F514),
    STAR(14, 8, 0x2B50),
    SEVEN(10, 8, 0x0037, 0xFE0F, 0x20E3);

    private final String display;
    private final int weight;
    private final int lineMultiplier;

    SlotSymbol(int weight, int lineMultiplier, int... codePoints) {
        this.display = new String(codePoints, 0, codePoints.length);
        this.weight = weight;
        this.lineMultiplier = lineMultiplier;
    }

    /** 前端顯示用的 emoji 字串。 */
    public String display() {
        return display;
    }

    /** 轉輪相對權重。 */
    public int weight() {
        return weight;
    }

    /** 中線三連倍率（派彩 = 下注 x 倍率）。 */
    public int lineMultiplier() {
        return lineMultiplier;
    }

    /** 所有符號的權重總和，作為加權抽樣的上界。 */
    public static final int TOTAL_WEIGHT = computeTotalWeight();

    private static int computeTotalWeight() {
        int sum = 0;
        for (SlotSymbol symbol : values()) {
            sum += symbol.weight;
        }
        return sum;
    }

    /**
     * 將 {@code [0, TOTAL_WEIGHT)} 的加權索引對應到符號（依宣告順序的累積權重區間）。
     *
     * @param index 加權索引，須落在 {@code [0, TOTAL_WEIGHT)}
     * @throws IllegalArgumentException 索引越界
     */
    public static SlotSymbol fromWeightedIndex(int index) {
        if (index < 0 || index >= TOTAL_WEIGHT) {
            throw new IllegalArgumentException(
                    "加權索引必須在 [0, " + TOTAL_WEIGHT + ")，實際為 " + index);
        }
        int cursor = index;
        for (SlotSymbol symbol : values()) {
            if (cursor < symbol.weight) {
                return symbol;
            }
            cursor -= symbol.weight;
        }
        // 數學上不可達（迴圈必在累積權重內命中）。
        throw new IllegalStateException("加權索引對應失敗: " + index);
    }
}
