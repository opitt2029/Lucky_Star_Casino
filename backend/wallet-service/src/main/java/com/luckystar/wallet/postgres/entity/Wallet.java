package com.luckystar.wallet.postgres.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.LocalDateTime;

@Entity
@Table(name = "wallets")
public class Wallet {

    @Id
    @Column(name = "player_id")
    private Long playerId;

    @Column(name = "balance", nullable = false)
    private Long balance;

    @Column(name = "frozen_amount", nullable = false)
    private Long frozenAmount;

    @Version
    @Column(name = "version", nullable = false)
    private Long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public Wallet() {}

    public Long getPlayerId()     { return playerId; }
    public Long getBalance()      { return balance; }
    public Long getFrozenAmount() { return frozenAmount; }
    public Long getVersion()      { return version; }
}
