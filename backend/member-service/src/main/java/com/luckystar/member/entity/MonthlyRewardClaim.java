package com.luckystar.member.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 月度累計簽到獎勵領取紀錄。
 *
 * <p>玩家當月「累計」（非連續）簽到天數達某里程碑（10/20/28 天）即可手動領取一次大獎。
 * 每筆紀錄代表某玩家在某年月、某里程碑的一次領取，UNIQUE(player_id, year_month, milestone_days)
 * 在 DB 層擋重複領取（與 wallet_transactions.idempotency_key 的冪等鍵互為保險）。
 *
 * <p>實際發星幣不在此服務直連 wallet DB，而是依 ADR-002 透過 outbox 發
 * {@code wallet.credit.request} 指令（subType=MONTHLY_REWARD），由 wallet-service 入帳。
 */
@Entity
@Table(
        name = "monthly_reward_claims",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_mrc_player_month_milestone",
                columnNames = {"player_id", "reward_month", "milestone_days"}))
@Getter
@Setter
@NoArgsConstructor
public class MonthlyRewardClaim {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "player_id", nullable = false)
    private Long playerId;

    /** 領取所屬年月，格式 yyyy-MM（台北時區），長度 7。
     *  欄位刻意命名 reward_month（避開 MySQL 關鍵字 YEAR_MONTH）。 */
    @Column(name = "reward_month", nullable = false, length = 7)
    private String rewardMonth;

    /** 達成的累計天數里程碑（10 / 20 / 28）。 */
    @Column(name = "milestone_days", nullable = false)
    private Integer milestoneDays;

    /** 領取的星幣金額（與里程碑對應，落帳時的權威金額）。 */
    @Column(name = "reward_amount", nullable = false)
    private Long rewardAmount;

    @Column(name = "claimed_at", nullable = false, updatable = false)
    private LocalDateTime claimedAt;

    @PrePersist
    void prePersist() {
        claimedAt = LocalDateTime.now();
    }
}
