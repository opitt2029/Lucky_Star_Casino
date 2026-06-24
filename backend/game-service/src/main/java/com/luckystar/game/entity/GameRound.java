package com.luckystar.game.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 遊戲對局紀錄（對應 PostgreSQL {@code game_rounds}，schema 見 database/postgres/init.sql）。
 *
 * <p>同時保存帳務（下注/派彩）與 Provably Fair 種子資訊（serverSeed/hash、clientSeed、nonce），
 * 讓玩家事後可用 {@code SHA-256(serverSeed:clientSeed:nonce:0)} 重算並驗證結果未遭竄改。
 *
 * <p>同步老虎機一次完成下注與結算，故直接以 {@code SETTLED} 狀態寫入並填 {@code settledAt}。
 */
@Entity
@Table(name = "game_rounds")
@Getter
@Setter
@NoArgsConstructor
public class GameRound {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 對外唯一識別碼（UUID）。 */
    @Column(name = "round_id", nullable = false, unique = true, length = 100)
    private String roundId;

    @Column(name = "player_id", nullable = false)
    private Long playerId;

    /** SLOT / BACCARAT。 */
    @Column(name = "game_type", nullable = false, length = 20)
    private String gameType;

    @Column(name = "bet_amount")
    private Long betAmount;

    @Column(name = "win_amount")
    private Long winAmount;

    /** 投注前錢包餘額（下注扣款前），供注單稽核「餘額變化」。 */
    @Column(name = "balance_before")
    private Long balanceBefore;

    /** 派彩後錢包餘額（結算入帳後），供注單稽核「餘額變化」。 */
    @Column(name = "balance_after")
    private Long balanceAfter;

    /** 下注時間（毫秒精度）。與 {@code settledAt}（派彩時間）區分，供注單稽核。 */
    @Column(name = "bet_at")
    private LocalDateTime betAt;

    /** 開獎後揭露的 server seed（Provably Fair）。 */
    @Column(name = "server_seed", length = 255)
    private String serverSeed;

    /** 下注前公開的承諾雜湊。 */
    @Column(name = "server_seed_hash", length = 255)
    private String serverSeedHash;

    @Column(name = "client_seed", length = 255)
    private String clientSeed;

    @Column(name = "nonce")
    private Long nonce;

    /**
     * 遊戲結果 JSON 字串（盤面、命中倍率、命中格等）。
     *
     * <p>正式 schema（init.sql）此欄為 PostgreSQL {@code TEXT}（不限長）。此處以較大的 VARCHAR
     * 長度宣告而非 {@code columnDefinition="TEXT"}：對測試用 H2 建表為標準 VARCHAR（必定支援），
     * 對 PostgreSQL {@code validate} 也相容（{@code text} 經 JDBC 回報為 VARCHAR 類別，型別相符；
     * validate 不檢查長度）。老虎機結果 JSON 僅約 200 字元，4000 有充裕餘裕。
     */
    @Column(name = "result_data", length = 4000)
    private String resultData;

    /** STARTED / SETTLED。 */
    @Column(name = "status", nullable = false, length = 20)
    private String status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "settled_at")
    private LocalDateTime settledAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }
}
