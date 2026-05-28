package com.luckystar.wallet.postgres.repository;

import com.luckystar.wallet.postgres.entity.Wallet;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WalletRepository extends JpaRepository<Wallet, Long> {
}
