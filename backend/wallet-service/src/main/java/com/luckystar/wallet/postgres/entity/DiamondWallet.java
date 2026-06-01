package com.luckystar.wallet.postgres.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * 鑽石錢包主表（T-100/T-101）。
 *
 * <p>與 {@link Wallet}（星幣）平行、同庫（PostgreSQL 寫端）。鑽石為點數卡兌換而來的硬通貨，
 * 無凍結/下注概念，故相較 Wallet 不設 frozenAmount。{@code @Version} 樂觀鎖供 T-103
 * 鑽石換星幣扣款時防止並發超扣。
 */
@Entity
@Table(name = "diamond_wallets")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiamondWallet {

    @Id
    @Column(name = "player_id")
    private Long playerId;

    @Column(name = "balance", nullable = false)
    @Builder.Default
    private Long balance = 0L;

    @Version
    @Column(name = "version", nullable = false)
    private Long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    void prePersist() {
        LocalDateTime now = LocalDateTime.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
