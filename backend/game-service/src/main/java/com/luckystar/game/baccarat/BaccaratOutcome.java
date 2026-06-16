package com.luckystar.game.baccarat;

import java.util.List;

/**
 * 百家樂一局結果（T-034，純資料）。由 {@link BaccaratGameService#deal} 依確定性隨機串流產生，
 * 相同 {@code (serverSeed, clientSeed, nonce)} 必得相同結果，可供玩家事後驗證（Provably Fair）。
 *
 * @param playerCards   閒家牌（2 或 3 張）
 * @param bankerCards   莊家牌（2 或 3 張）
 * @param playerScore   閒家點數（個位，0~9）
 * @param bankerScore   莊家點數（個位，0~9）
 * @param result        贏家（PLAYER / BANKER / TIE）
 * @param playerNatural 閒家是否為前兩張即 8/9（天牌）
 * @param bankerNatural 莊家是否為前兩張即 8/9（天牌）
 */
public record BaccaratOutcome(
        List<Card> playerCards,
        List<Card> bankerCards,
        int playerScore,
        int bankerScore,
        BaccaratResult result,
        boolean playerNatural,
        boolean bankerNatural) {
}
