package com.luckystar.game.baccarat;

import com.luckystar.game.rng.RandomStream;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * 百家樂遊戲邏輯（T-034）。實作標準百家樂（Punto Banco）規則：莊/閒各發 2 張、第三張補牌規則、
 * 點數計算（總和取個位）、莊/閒/和三押注區，莊贏派彩扣 5% 傭金。完整規則見
 * {@code docs/baccarat-rules.md}。
 *
 * <p><b>發牌來源</b>：牌由傳入的 {@link RandomStream}（T-030）以固定順序抽出——每張牌先抽
 * {@code nextInt(13)} 決定牌面、再抽 {@code nextInt(4)} 決定花色。發牌順序為
 * 閒1、莊1、閒2、莊2，必要時依補牌規則續抽。相同三元組必產出相同牌局，達成可驗證公平
 * （Provably Fair）。為簡化且維持各牌面等機率，採「無限靴」模型（每張牌獨立均勻抽取、可重複），
 * 此設計取捨記於規則文件。
 *
 * <p>本類別無狀態，可安全共用。核心邏輯 {@link #play(CardSource)} 與結算 {@link #settle}
 * 皆為純函式，便於以指定牌組做單元測試。
 */
@Component
public class BaccaratGameService {

    /** 牌面數（A~K）。 */
    static final int RANKS = 13;
    /** 花色數。 */
    static final int SUITS = 4;

    /** 和局派彩賠率 8:1（押中和：本金 + 8 倍）。 */
    public static final long TIE_PAYOUT_RATIO = 8L;
    /** 莊贏傭金比率 5%。 */
    public static final double BANKER_COMMISSION_RATE = 0.05d;

    /** 發牌來源：每次回傳下一張牌。供 {@link #deal} 包裝 RNG，亦供測試注入固定牌組。 */
    @FunctionalInterface
    public interface CardSource {
        Card next();
    }

    /**
     * 依確定性隨機串流發一局百家樂。
     *
     * @param stream RNG 串流（由三元組建立）
     * @return 本局結果
     */
    public BaccaratOutcome deal(RandomStream stream) {
        if (stream == null) {
            throw new IllegalArgumentException("stream 不可為 null");
        }
        return play(() -> new Card(stream.nextInt(RANKS), stream.nextInt(SUITS)));
    }

    /**
     * 百家樂核心發牌與補牌邏輯（純函式）。依序自 {@code source} 取牌：閒1、莊1、閒2、莊2，
     * 再依標準規則決定是否補第三張。
     *
     * @param source 發牌來源
     * @return 本局結果
     */
    public BaccaratOutcome play(CardSource source) {
        List<Card> player = new ArrayList<>(3);
        List<Card> banker = new ArrayList<>(3);

        // 發牌順序：閒1、莊1、閒2、莊2
        player.add(source.next());
        banker.add(source.next());
        player.add(source.next());
        banker.add(source.next());

        int playerScore = score(player);
        int bankerScore = score(banker);
        boolean playerNatural = playerScore >= 8;
        boolean bankerNatural = bankerScore >= 8;

        // 任一方天牌（8/9）→ 雙方皆不補牌
        if (!playerNatural && !bankerNatural) {
            Integer playerThirdValue = null;

            // 閒家規則：0~5 補牌，6~7 停牌
            if (playerScore <= 5) {
                Card third = source.next();
                player.add(third);
                playerThirdValue = third.value();
                playerScore = score(player);
            }

            // 莊家規則
            if (bankerDraws(bankerScore, playerThirdValue)) {
                banker.add(source.next());
                bankerScore = score(banker);
            }
        }

        BaccaratResult result = decide(playerScore, bankerScore);
        return new BaccaratOutcome(
                List.copyOf(player), List.copyOf(banker),
                playerScore, bankerScore, result, playerNatural, bankerNatural);
    }

    /**
     * 莊家補牌規則。
     *
     * <ul>
     *   <li>閒家未補牌（{@code playerThirdValue == null}）：莊家比照閒家，0~5 補、6~7 停。</li>
     *   <li>閒家補了第三張（值為 p3）：依莊家點數與 p3 查表決定——
     *       0~2 補；3 補（除非 p3=8）；4 補（p3∈2~7）；5 補（p3∈4~7）；6 補（p3∈6~7）；7 停。</li>
     * </ul>
     */
    static boolean bankerDraws(int bankerScore, Integer playerThirdValue) {
        if (playerThirdValue == null) {
            return bankerScore <= 5;
        }
        int p3 = playerThirdValue;
        return switch (bankerScore) {
            case 0, 1, 2 -> true;
            case 3 -> p3 != 8;
            case 4 -> p3 >= 2 && p3 <= 7;
            case 5 -> p3 >= 4 && p3 <= 7;
            case 6 -> p3 >= 6 && p3 <= 7;
            default -> false; // 7（含理論上不會到的 >7）
        };
    }

    /** 比較莊閒點數決定贏家。 */
    static BaccaratResult decide(int playerScore, int bankerScore) {
        if (playerScore > bankerScore) {
            return BaccaratResult.PLAYER;
        }
        if (bankerScore > playerScore) {
            return BaccaratResult.BANKER;
        }
        return BaccaratResult.TIE;
    }

    /** 一手牌的百家樂點數（總和取個位）。 */
    static int score(List<Card> cards) {
        int sum = 0;
        for (Card c : cards) {
            sum += c.value();
        }
        return sum % 10;
    }

    /**
     * 依本局結果與各押注區下注額計算派彩（純函式）。
     *
     * <p>派彩（含本金）規則：
     * <ul>
     *   <li>押中 PLAYER：1:1 → 派 {@code bet × 2}。</li>
     *   <li>押中 BANKER：1:1 但扣 5% 傭金 → 派 {@code bet × 2 − floor(bet × 5%)}。</li>
     *   <li>押中 TIE：8:1 → 派 {@code bet × 9}。</li>
     *   <li>和局時，押 PLAYER / BANKER 視為平手退回本金（push）→ 派 {@code bet}。</li>
     *   <li>其餘（押錯）→ 派 0。</li>
     * </ul>
     *
     * @param outcome 本局結果
     * @param bets    各押注區下注額（金額須為正；未押的區可省略或填 0）
     * @return 結算結果（總下注、總派彩、各區明細）
     */
    public BaccaratSettlement settle(BaccaratOutcome outcome, Map<BaccaratResult, Long> bets) {
        if (outcome == null) {
            throw new IllegalArgumentException("outcome 不可為 null");
        }
        if (bets == null || bets.isEmpty()) {
            throw new IllegalArgumentException("至少需一個押注區");
        }
        BaccaratResult result = outcome.result();
        Map<BaccaratResult, Long> payouts = new EnumMap<>(BaccaratResult.class);
        long totalBet = 0L;
        long totalPayout = 0L;

        for (Map.Entry<BaccaratResult, Long> e : bets.entrySet()) {
            BaccaratResult area = e.getKey();
            long bet = e.getValue() == null ? 0L : e.getValue();
            if (bet < 0) {
                throw new IllegalArgumentException("下注額不可為負：" + area + "=" + bet);
            }
            if (bet == 0) {
                continue;
            }
            totalBet += bet;
            long payout = payoutFor(area, result, bet);
            payouts.put(area, payout);
            totalPayout += payout;
        }

        return new BaccaratSettlement(result, totalBet, totalPayout, payouts);
    }

    /** 單一押注區的派彩（含本金）。 */
    private static long payoutFor(BaccaratResult area, BaccaratResult result, long bet) {
        if (result == BaccaratResult.TIE) {
            if (area == BaccaratResult.TIE) {
                return Math.multiplyExact(bet, 1L + TIE_PAYOUT_RATIO); // 本金 + 8 倍
            }
            // 和局：押莊/閒退回本金（push）
            return bet;
        }
        if (area != result) {
            return 0L; // 押錯（含非和局時押 TIE）
        }
        if (area == BaccaratResult.BANKER) {
            long commission = (long) Math.floor(bet * BANKER_COMMISSION_RATE);
            return Math.multiplyExact(bet, 2L) - commission; // 1:1 扣 5% 傭金
        }
        return Math.multiplyExact(bet, 2L); // PLAYER 1:1
    }
}
