package com.luckystar.wallet.postgres.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Transactional Outbox 事件列（藍圖 04 P2）。
 *
 * <p>與 member 的 {@code OutboxEvent} 同構，但落在 wallet 的**寫端 PostgreSQL**——
 * 因為要與 {@code wallet_transactions} / {@code wallets} 的異動進同一個交易，達成
 * 「帳務寫入」與「待發事件寫入」的原子性（Outbox 的核心）。
 *
 * <p>⚠️ 本 entity 必須落在 {@code com.luckystar.wallet.postgres.entity} 套件下，
 * 才會被 {@code DataSourceConfig} 的 Postgres {@code EntityManagerFactory}（packages =
 * {@code com.luckystar.wallet.postgres.entity}）掃描到（AGENTS.md 雷區 5 / ADR-001）。
 * 放錯套件會讓 repository 注入失敗、服務啟動就掛。
 */
@Entity
@Table(name = "wallet_outbox")
@Getter
@Setter
@NoArgsConstructor
public class WalletOutbox {

    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_SENT = "SENT";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String topic;

    @Column(name = "kafka_key", length = 100)
    private String kafkaKey;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String payload;

    @Column(nullable = false, length = 20)
    private String status = STATUS_PENDING;

    @Column(name = "retry_count", nullable = false)
    private int retryCount = 0;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "sent_at")
    private LocalDateTime sentAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }
}
