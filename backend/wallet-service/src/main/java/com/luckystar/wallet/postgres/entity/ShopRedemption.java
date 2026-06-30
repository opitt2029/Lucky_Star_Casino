package com.luckystar.wallet.postgres.entity;

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
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 禮品商城兌換紀錄（帳務寫端，ADR-006）。對應 {@code database/postgres/migration/V13__add_shop.sql} 的
 * {@code shop_redemptions}。
 *
 * <p>每筆＝某玩家兌換某商品一次，與星幣扣款（{@code wallet_transactions} sub_type=SHOP_PURCHASE）在
 * <b>同一 Postgres 交易</b>原子寫入。為帳務真相＋玩家背包來源。{@code idempotency_key} 與該筆扣款流水同鍵，
 * DB UNIQUE 防重複兌換。位於 PostgreSQL 寫端（package {@code com.luckystar.wallet.postgres.entity}）。
 */
@Entity
@Table(name = "shop_redemptions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ShopRedemption {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "player_id", nullable = false)
    private Long playerId;

    @Column(name = "item_code", nullable = false, length = 50)
    private String itemCode;

    /** 兌換當下商品名稱快照（目錄改名不影響舊紀錄）。 */
    @Column(name = "item_name", nullable = false, length = 100)
    private String itemName;

    /** 花費星幣（兌換當下定價快照）。 */
    @Column(name = "star_spent", nullable = false)
    private Long starSpent;

    @Column(name = "balance_before")
    private Long balanceBefore;

    @Column(name = "balance_after")
    private Long balanceAfter;

    @Column(name = "idempotency_key", length = 100, unique = true)
    private String idempotencyKey;

    @Column(name = "status", nullable = false, length = 20)
    private String status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    void prePersist() {
        if (this.createdAt == null) {
            this.createdAt = LocalDateTime.now();
        }
        if (this.status == null) {
            this.status = "COMPLETED";
        }
    }
}
