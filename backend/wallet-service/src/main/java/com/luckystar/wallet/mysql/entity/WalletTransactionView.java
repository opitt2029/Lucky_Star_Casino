package com.luckystar.wallet.mysql.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * MySQL 讀端 wallet_transactions 唯讀視圖（ADR-001：CQRS 查詢讀端）。
 *
 * <p>對應 {@code database/mysql/migration/V1__init_schema.sql} 的 wallet_transactions 讀庫副本，
 * 供帳務流水查詢 API（T-025）分頁使用。資料由 PostgreSQL 主庫經 Kafka 事件 / 雙寫同步而來，
 * 因此此端為<b>最終一致性</b>、且<b>只讀</b>——不要在此實體上做任何寫入。
 *
 * <p>主鍵 {@code id} 與 PostgreSQL 主庫保持一致；讀庫不設 idempotency_key 唯一約束。
 * 餘額即時查詢請走 PostgreSQL（見 T-021），不要用此讀庫。
 *
 * <p>由 {@code mysqlEntityManagerFactory} 管理（package {@code com.luckystar.wallet.mysql.entity}）。
 */
@Entity
@Table(name = "wallet_transactions")
@Getter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WalletTransactionView {

    @Id
    private Long id;

    @Column(name = "player_id", nullable = false)
    private Long playerId;

    @Column(name = "type", nullable = false, length = 10)
    private String type;

    @Column(name = "sub_type", nullable = false, length = 20)
    private String subType;

    @Column(name = "amount", nullable = false)
    private Long amount;

    @Column(name = "balance_before")
    private Long balanceBefore;

    @Column(name = "balance_after")
    private Long balanceAfter;

    @Column(name = "reference_id", length = 100)
    private String referenceId;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;
}
