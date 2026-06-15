package com.luckystar.admin.postgres.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * 錢包餘額唯讀視圖（PostgreSQL {@code wallets} 寫庫，T-051 詳情）。
 * 餘額以寫庫為準（最終一致性下讀庫可能落後）。
 */
@Entity
@Table(name = "wallets")
public class WalletRead {

    @Id
    @Column(name = "player_id")
    private Long playerId;

    private Long balance;

    @Column(name = "frozen_amount")
    private Long frozenAmount;

    protected WalletRead() {
    }

    public Long getPlayerId() {
        return playerId;
    }

    public Long getBalance() {
        return balance;
    }

    public Long getFrozenAmount() {
        return frozenAmount;
    }
}
