package com.luckystar.game.session;

import java.time.Instant;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 遊戲對局 Session（T-033）。暫存於 Redis（Key: {@code game:session:{playerId}:{roundId}}，TTL 30 分鐘），
 * 承載 Provably Fair commit-reveal 流程所需的局內狀態：
 *
 * <ul>
 *   <li>開局時寫入 {@code serverSeed}（保密）、{@code serverSeedHash}（承諾雜湊）、{@code clientSeed}、
 *       {@code betAmount}，狀態為 {@link GameSessionState#STARTED}。</li>
 *   <li>結算後轉為 {@link GameSessionState#SETTLED}，玩家可在 TTL 內取回 serverSeed 驗證本局公平性。</li>
 * </ul>
 *
 * <p>以 Redis Hash（每欄位一個 field）存入（見 {@link GameSessionService}）。欄位刻意與
 * {@code game_rounds} 對齊，方便結算時落地對局紀錄。老虎機用單一 {@code betAmount}；
 * 百家樂多區押注額外用 {@code betPlayer / betBanker / betTie}，{@code betAmount} 存三區總額。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GameSession {

    /** 對局唯一識別碼（UUID），對外可見。 */
    private String roundId;

    /** 玩家 ID（gateway 注入的 X-User-Id）。 */
    private Long playerId;

    /** 遊戲類型，SLOT / BACCARAT。 */
    private String gameType;

    /** 下注金額（星幣）；百家樂為三押注區總額。 */
    private Long betAmount;

    /** 投注前錢包餘額（開局扣款前），結算落地對局時寫入 game_rounds 供注單稽核。 */
    private Long balanceBefore;

    /** 百家樂：押閒金額（其他遊戲為 null）。 */
    private Long betPlayer;

    /** 百家樂：押莊金額（其他遊戲為 null）。 */
    private Long betBanker;

    /** 百家樂：押和金額（其他遊戲為 null）。 */
    private Long betTie;

    /** 保密 server seed；結算前不對外揭露。 */
    private String serverSeed;

    /** server seed 的承諾雜湊 {@code SHA-256(serverSeed)}，開局前即公布。 */
    private String serverSeedHash;

    /** 玩家提供（或伺服器產生）的 client seed。 */
    private String clientSeed;

    /** 本局 nonce（同一 seed 配對下遞增序號）。 */
    private Long nonce;

    /** Session 狀態：STARTED / SETTLED。 */
    private GameSessionState state;

    /** 開局時間（毫秒 epoch），供稽核與排序。 */
    private Instant createdAt;
}
