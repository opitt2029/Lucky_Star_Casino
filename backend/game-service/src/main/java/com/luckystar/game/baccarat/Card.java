package com.luckystar.game.baccarat;

/**
 * 一張撲克牌（T-034）。以 {@code rankIndex}（0=A、1..8=2..9、9=10、10=J、11=Q、12=K）與
 * {@code suitIndex}（0=♠、1=♥、2=♦、3=♣）表示。
 *
 * <p>百家樂只關心點數：A 為 1、2~9 為面值、10/J/Q/K 為 0（見 {@link #value()}）。花色僅供顯示。
 *
 * @param rankIndex 牌面索引 [0,12]
 * @param suitIndex 花色索引 [0,3]
 */
public record Card(int rankIndex, int suitIndex) {

    /** 牌面標籤，索引對應 {@code rankIndex}。 */
    private static final String[] RANK_LABELS =
            {"A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"};

    /** 花色符號，索引對應 {@code suitIndex}。 */
    private static final String[] SUIT_SYMBOLS = {"♠", "♥", "♦", "♣"}; // ♠♥♦♣

    public Card {
        if (rankIndex < 0 || rankIndex > 12) {
            throw new IllegalArgumentException("rankIndex 須在 [0,12]，實際為 " + rankIndex);
        }
        if (suitIndex < 0 || suitIndex > 3) {
            throw new IllegalArgumentException("suitIndex 須在 [0,3]，實際為 " + suitIndex);
        }
    }

    /**
     * 百家樂點數值：A=1、2~9=面值、10/J/Q/K=0。
     */
    public int value() {
        if (rankIndex == 0) {
            return 1;          // A
        }
        if (rankIndex <= 8) {
            return rankIndex + 1; // 2~9
        }
        return 0;              // 10 / J / Q / K
    }

    /** 顯示字串，例如 {@code "A♠"}、{@code "10♦"}。 */
    public String display() {
        return RANK_LABELS[rankIndex] + SUIT_SYMBOLS[suitIndex];
    }
}
