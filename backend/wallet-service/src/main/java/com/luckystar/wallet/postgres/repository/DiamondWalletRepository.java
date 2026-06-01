package com.luckystar.wallet.postgres.repository;

import com.luckystar.wallet.postgres.entity.DiamondWallet;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DiamondWalletRepository extends JpaRepository<DiamondWallet, Long> {
}
