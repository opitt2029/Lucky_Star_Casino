package com.luckystar.wallet.mysql.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 禮品商城目錄（ADR-006）。對應 {@code database/mysql/migration/V10__add_shop_items.sql} 的 {@code shop_items}。
 *
 * <p>位於 MySQL（CQRS 讀端，ADR-001），由 {@code mysqlEntityManagerFactory} / {@code mysqlTransactionManager}
 * 管理（package {@code com.luckystar.wallet.mysql.entity}）。admin-service 負責 CRUD（上下架/改價），
 * wallet-service 只讀（列目錄、兌換時驗價）。兌換紀錄 {@code shop_redemptions} 則在 PostgreSQL 寫端。
 */
@Entity
@Table(name = "shop_items")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ShopItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** 商品代號（前端/兌換對應鍵）。UNIQUE。 */
    @Column(name = "item_code", nullable = false, unique = true)
    private String itemCode;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "caption")
    private String caption;

    /** 兌換成本（星幣，>0）。 */
    @Column(name = "cost_star", nullable = false)
    private Long costStar;

    /** 前端圖片資產鍵（如 shopPrizeA）。 */
    @Column(name = "asset_key")
    private String assetKey;

    /** 顯示順序，小者在前。 */
    @Column(name = "sort_order", nullable = false)
    private Integer sortOrder;

    /** 是否上架：true 上架 / false 下架。 */
    @Column(name = "active", nullable = false)
    private Boolean active;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    void onCreate() {
        LocalDateTime now = LocalDateTime.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
