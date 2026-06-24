package com.luckystar.game.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 虧損返利發放記錄（{@code cashback_records}，schema 見 V9 migration）。
 *
 * <p>{@code UNIQUE(player_id, period_type, period_start)} 確保同一玩家同一期間只發一次，
 * 天然防止排程重複執行或補跑造成重複入帳。
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "cashback_records")
public class CashbackRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "player_id", nullable = false)
    private Long playerId;

    /** DAILY 或 WEEKLY。 */
    @Column(name = "period_type", nullable = false, length = 10)
    private String periodType;

    /** 日返利 = 昨日；週返利 = 上週一。 */
    @Column(name = "period_start", nullable = false)
    private LocalDate periodStart;

    @Column(name = "loss_amount", nullable = false)
    private long lossAmount;

    @Column(name = "cashback_rate", nullable = false, precision = 5, scale = 4)
    private BigDecimal cashbackRate;

    @Column(name = "cashback_amount", nullable = false)
    private long cashbackAmount;

    /** wallet.credit.request 的冪等鍵，格式 cashback-{daily|weekly}-{yyyyMMdd}-{playerId}。 */
    @Column(name = "idempotency_key", nullable = false, length = 100, unique = true)
    private String idempotencyKey;

    /** PENDING → CREDITED（成功）/ FAILED（Kafka 異常）。 */
    @Column(name = "status", nullable = false, length = 20)
    private String status = "PENDING";

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "credited_at")
    private LocalDateTime creditedAt;

    @PrePersist
    void prePersist() {
        if (createdAt == null) createdAt = LocalDateTime.now();
    }
}
