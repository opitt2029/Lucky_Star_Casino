package com.luckystar.admin.postgres.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

/**
 * 遊戲 RTP 統計唯讀視圖（PostgreSQL {@code game_rtp_stats}，由 game-service T-037 排程寫入；T-053）。
 * admin 僅讀取彙整、不重算 RTP。
 */
@Entity
@Table(name = "game_rtp_stats")
public class GameRtpStatRead {

    @Id
    private Long id;

    @Column(name = "game_type")
    private String gameType;

    @Column(name = "total_bet")
    private Long totalBet;

    @Column(name = "total_win")
    private Long totalWin;

    @Column(name = "round_count")
    private Integer roundCount;

    @Column(name = "calculated_at")
    private LocalDateTime calculatedAt;

    public GameRtpStatRead() {
    }

    public Long getId() {
        return id;
    }

    public String getGameType() {
        return gameType;
    }

    public Long getTotalBet() {
        return totalBet;
    }

    public Long getTotalWin() {
        return totalWin;
    }

    public Integer getRoundCount() {
        return roundCount;
    }

    public LocalDateTime getCalculatedAt() {
        return calculatedAt;
    }
}
