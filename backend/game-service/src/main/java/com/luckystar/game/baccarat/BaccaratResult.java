package com.luckystar.game.baccarat;

/**
 * 百家樂結果 / 押注區（T-034）。三選一：
 *
 * <ul>
 *   <li>{@link #PLAYER}：閒家點數較大。</li>
 *   <li>{@link #BANKER}：莊家點數較大（莊贏派彩需扣 5% 傭金）。</li>
 *   <li>{@link #TIE}：莊閒同點，和局。</li>
 * </ul>
 *
 * <p>同一個列舉同時用於「本局贏家」與「玩家押注區」——押注區與可能的贏家一一對應。
 */
public enum BaccaratResult {
    PLAYER,
    BANKER,
    TIE
}
