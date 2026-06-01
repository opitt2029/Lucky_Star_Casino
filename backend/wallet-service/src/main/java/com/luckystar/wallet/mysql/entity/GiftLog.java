package com.luckystar.wallet.mysql.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * MySQL 好友贈幣紀錄（T-026）。對應 {@code database/mysql/migration/V1__init_schema.sql} 的 {@code gift_logs}。
 *
 * <p>此表為「贈送歷史稽核」用途，<b>不是</b>金流真相來源——金流真相在 PostgreSQL 的
 * {@code wallet_transactions}（sub_type='GIFT' 的 DEBIT/CREDIT 雙分錄）。寫入 gift_logs 是
 * 轉帳 commit 之後的 best-effort 步驟（見 {@link com.luckystar.wallet.service.GiftService}），
 * 失敗只記 WARN 不回滾，故稽核列可能少於實際轉帳列（已知限制）。
 *
 * <p>由 {@code mysqlEntityManagerFactory} 管理（package {@code com.luckystar.wallet.mysql.entity}）。
 */
@Entity
@Table(name = "gift_logs")
@Getter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class GiftLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "sender_id", nullable = false)
    private Long senderId;

    @Column(name = "receiver_id", nullable = false)
    private Long receiverId;

    @Column(name = "amount", nullable = false)
    private Long amount;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @PrePersist
    void prePersist() {
        if (this.createdAt == null) {
            this.createdAt = LocalDateTime.now();
        }
    }
}
