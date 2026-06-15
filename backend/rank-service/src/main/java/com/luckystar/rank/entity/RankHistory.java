package com.luckystar.rank.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "rank_history")
public class RankHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "player_id", nullable = false)
    private Long playerId;

    @Column(name = "nickname", length = 50)
    private String nickname;

    @Column(name = "balance", nullable = false)
    private Long balance;

    @Column(name = "rank", nullable = false)
    private Integer rank;

    @Column(name = "week_start", nullable = false)
    private LocalDate weekStart;

    @Column(name = "created_at", insertable = false, updatable = false)
    private LocalDateTime createdAt;

    protected RankHistory() {
    }

    public RankHistory(Long playerId, String nickname, Long balance, Integer rank, LocalDate weekStart) {
        this.playerId = playerId;
        this.nickname = nickname;
        this.balance = balance;
        this.rank = rank;
        this.weekStart = weekStart;
    }

    public Long getId() {
        return id;
    }

    public Long getPlayerId() {
        return playerId;
    }

    public String getNickname() {
        return nickname;
    }

    public Long getBalance() {
        return balance;
    }

    public Integer getRank() {
        return rank;
    }

    public LocalDate getWeekStart() {
        return weekStart;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
