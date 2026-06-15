package com.luckystar.game.session;

/**
 * 遊戲 Session 狀態（T-033）。對齊 {@code game_rounds.status} 的 CHECK 約束（STARTED / SETTLED）。
 *
 * <ul>
 *   <li>{@link #STARTED}：開局，已產生並承諾 serverSeedHash、下注尚未結算。</li>
 *   <li>{@link #SETTLED}：本局已結算，serverSeed 可揭露供玩家驗證。</li>
 * </ul>
 */
public enum GameSessionState {
    STARTED,
    SETTLED
}
