package com.luckystar.admin.postgres.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

/**
 * 後台敏感操作稽核紀錄（PostgreSQL {@code admin_action_logs}，T-055）。
 *
 * 目前用於 GM 發幣（{@code action_type = GM_GRANT}）：每次發幣寫一筆，
 * {@code idempotency_key} UNIQUE 兼作去重鍵與 wallet.credit.request 的冪等鍵。
 */
@Entity
@Table(name = "admin_action_logs")
public class AdminActionLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "operator", nullable = false, length = 50)
    private String operator;

    @Column(name = "action_type", nullable = false, length = 30)
    private String actionType;

    @Column(name = "target_player_id")
    private Long targetPlayerId;

    @Column(name = "amount")
    private Long amount;

    @Column(name = "reason", length = 255)
    private String reason;

    @Column(name = "idempotency_key", unique = true, length = 100)
    private String idempotencyKey;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    protected AdminActionLog() {
        // JPA
    }

    public AdminActionLog(
            String operator,
            String actionType,
            Long targetPlayerId,
            Long amount,
            String reason,
            String idempotencyKey) {
        this.operator = operator;
        this.actionType = actionType;
        this.targetPlayerId = targetPlayerId;
        this.amount = amount;
        this.reason = reason;
        this.idempotencyKey = idempotencyKey;
    }

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }

    public Long getId() {
        return id;
    }

    public String getOperator() {
        return operator;
    }

    public String getActionType() {
        return actionType;
    }

    public Long getTargetPlayerId() {
        return targetPlayerId;
    }

    public Long getAmount() {
        return amount;
    }

    public String getReason() {
        return reason;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
