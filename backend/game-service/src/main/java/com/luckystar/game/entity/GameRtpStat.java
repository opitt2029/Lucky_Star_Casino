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
 * 遊戲 RTP 統計彙總（T-037，對應 PostgreSQL {@code game_rtp_stats}，schema 見 database/postgres/init.sql）。
 *
 * <p>由排程每小時統計各遊戲近一萬局的下注/派彩總額並寫入一筆，供 Admin 監控實際 RTP
 * （{@code total_win / total_bet}）是否偏離設計值。
 */
@Entity
@Table(name = "game_rtp_stats")
@Getter
@Setter
@NoArgsConstructor
public class GameRtpStat {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** SLOT / BACCARAT。 */
    @Column(name = "game_type", nullable = false, length = 20)
    private String gameType;

    @Column(name = "total_bet", nullable = false)
    private Long totalBet;

    @Column(name = "total_win", nullable = false)
    private Long totalWin;

    @Column(name = "round_count", nullable = false)
    private Integer roundCount;

    @Column(name = "calculated_at", nullable = false)
    private LocalDateTime calculatedAt;

    @PrePersist
    void onCreate() {
        if (calculatedAt == null) {
            calculatedAt = LocalDateTime.now();
        }
    }
}
