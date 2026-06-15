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

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
