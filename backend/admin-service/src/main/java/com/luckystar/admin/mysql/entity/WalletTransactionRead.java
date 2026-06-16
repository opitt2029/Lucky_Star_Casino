package com.luckystar.admin.mysql.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

/**
 * 帳務流水唯讀視圖（MySQL {@code wallet_transactions} 讀庫，T-051 詳情 / T-052 報表）。
 * type：DEBIT / CREDIT / BONUS；sub_type：BET / WIN / CHECKIN / TASK / GIFT / GM_REWARD / BANKRUPTCY_AID。
 */
@Entity
@Table(name = "wallet_transactions")
public class WalletTransactionRead {

    @Id
    private Long id;

    @Column(name = "player_id")
    private Long playerId;

    private String type;

    @Column(name = "sub_type")
    private String subType;

    private Long amount;

    @Column(name = "balance_before")
    private Long balanceBefore;

    @Column(name = "balance_after")
    private Long balanceAfter;

    @Column(name = "reference_id")
    private String referenceId;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    public WalletTransactionRead() {
    }

    public Long getId() {
        return id;
    }

    public Long getPlayerId() {
        return playerId;
    }

    public String getType() {
        return type;
    }

    public String getSubType() {
        return subType;
    }

    public Long getAmount() {
        return amount;
    }

    public Long getBalanceBefore() {
        return balanceBefore;
    }

    public Long getBalanceAfter() {
        return balanceAfter;
    }

    public String getReferenceId() {
        return referenceId;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
