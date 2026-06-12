package com.luckystar.rank.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(
        name = "rank_daily_snapshots",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_rank_daily_snapshots_player_date",
                columnNames = {"player_id", "snapshot_date"}))
public class RankDailySnapshot {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "player_id", nullable = false)
    private Long playerId;

    @Column(name = "balance", nullable = false)
    private Long balance;

    @Column(name = "snapshot_date", nullable = false)
    private LocalDate snapshotDate;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    protected RankDailySnapshot() {
    }

    public RankDailySnapshot(Long playerId, Long balance, LocalDate snapshotDate) {
        this.playerId = playerId;
        this.balance = balance;
        this.snapshotDate = snapshotDate;
    }

    public Long getId() {
        return id;
    }

    public Long getPlayerId() {
        return playerId;
    }

    public Long getBalance() {
        return balance;
    }

    public LocalDate getSnapshotDate() {
        return snapshotDate;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
