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
 * 異常告警紀錄（PostgreSQL {@code admin_alerts}，T-054）。
 *
 * 由規則引擎在偵測到大額中獎 / 高頻下注 / 異常帳務時寫入，供管理員後續處理。
 * 表已存在於 init.sql（與 V1 migration），此處僅補 entity / repository。
 */
@Entity
@Table(name = "admin_alerts")
public class AdminAlert {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "player_id", nullable = false)
    private Long playerId;

    @Column(name = "alert_type", nullable = false, length = 30)
    private String alertType;

    @Column(name = "detail", columnDefinition = "TEXT")
    private String detail;

    @Column(name = "is_resolved", nullable = false)
    private boolean resolved = false;

    @Column(name = "resolved_by", length = 50)
    private String resolvedBy;

    @Column(name = "resolved_at")
    private LocalDateTime resolvedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    protected AdminAlert() {
        // JPA
    }

    public AdminAlert(Long playerId, String alertType, String detail) {
        this.playerId = playerId;
        this.alertType = alertType;
        this.detail = detail;
        this.resolved = false;
    }

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }

    /**
     * 標記為已處理（單向：告警一經處理不提供退回未處理，故不做 setter）。
     * 同時記錄處理者與處理時間，供事後追溯（T-054 稽核）。
     */
    public void markResolved(String operator) {
        this.resolved = true;
        this.resolvedBy = operator;
        this.resolvedAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public Long getPlayerId() {
        return playerId;
    }

    public String getAlertType() {
        return alertType;
    }

    public String getDetail() {
        return detail;
    }

    public boolean isResolved() {
        return resolved;
    }

    public String getResolvedBy() {
        return resolvedBy;
    }

    public LocalDateTime getResolvedAt() {
        return resolvedAt;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
