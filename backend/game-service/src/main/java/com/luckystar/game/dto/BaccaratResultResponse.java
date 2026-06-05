package com.luckystar.game.dto;

import java.util.List;
import java.util.Map;
import lombok.Builder;
import lombok.Data;

/**
 * 百家樂結算回應（T-035）。對應 {@code POST /api/v1/game/baccarat/{roundId}/result}。
 *
 * <p>揭露完整牌局、各押注區派彩與 Provably Fair 種子（含已揭露的 serverSeed），供玩家事後以
 * {@code GET /api/v1/game/verify/{roundId}}（T-036）獨立驗證。
 */
@Data
@Builder
public class BaccaratResultResponse {

    /** 本局唯一識別碼。 */
    private String roundId;

    /** 遊戲類型固定為 {@code "baccarat"}。 */
    private String game;

    /** 閒家牌（顯示字串，如 {@code "A♠"}）。 */
    private List<String> playerCards;

    /** 莊家牌（顯示字串）。 */
    private List<String> bankerCards;

    /** 閒家點數（0~9）。 */
    private int playerScore;

    /** 莊家點數（0~9）。 */
    private int bankerScore;

    /** 贏家：{@code PLAYER / BANKER / TIE}。 */
    private String result;

    /** 各押注區金額（player / banker / tie）。 */
    private Map<String, Long> bets;

    /** 各押注區派彩（含本金；輸的區為 0、和局時莊/閒退本金）。 */
    private Map<String, Long> payouts;

    /** 下注總額。 */
    private long totalBet;

    /** 派彩總額。 */
    private long totalPayout;

    /** 結算後錢包視圖。 */
    private WalletView wallet;

    // ---- Provably Fair 揭露欄位 ----

    /** 本局揭露的 server seed。 */
    private String serverSeed;

    /** server seed 的承諾雜湊。 */
    private String serverSeedHash;

    /** 本局使用的 client seed。 */
    private String clientSeed;

    /** 本局 nonce。 */
    private long nonce;
}
