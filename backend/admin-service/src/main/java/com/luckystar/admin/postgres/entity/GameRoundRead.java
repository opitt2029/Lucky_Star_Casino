package com.luckystar.admin.postgres.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

/**
 * 對局紀錄唯讀視圖（PostgreSQL {@code game_rounds}，T-051 詳情）。
 */
@Entity
@Table(name = "game_rounds")
public class GameRoundRead {

    @Id
    private Long id;

    @Column(name = "round_id")
    private String roundId;

    @Column(name = "player_id")
    private Long playerId;

    @Column(name = "game_type")
    private String gameType;

    @Column(name = "bet_amount")
    private Long betAmount;

    @Column(name = "win_amount")
    private Long winAmount;

    private String status;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "settled_at")
    private LocalDateTime settledAt;

    protected GameRoundRead() {
    }

    public Long getId() {
        return id;
    }

    public String getRoundId() {
        return roundId;
    }

    public Long getPlayerId() {
        return playerId;
    }

    public String getGameType() {
        return gameType;
    }

    public Long getBetAmount() {
        return betAmount;
    }

    public Long getWinAmount() {
        return winAmount;
    }

    public String getStatus() {
        return status;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getSettledAt() {
        return settledAt;
    }
}
