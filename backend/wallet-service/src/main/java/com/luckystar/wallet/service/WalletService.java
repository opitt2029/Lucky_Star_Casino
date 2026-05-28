package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.WalletBalanceResponse;
import com.luckystar.wallet.exception.WalletNotFoundException;
import com.luckystar.wallet.postgres.entity.Wallet;
import com.luckystar.wallet.postgres.repository.WalletRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WalletService {

    private final WalletRepository walletRepository;

    public WalletService(WalletRepository walletRepository) {
        this.walletRepository = walletRepository;
    }

    @Transactional(readOnly = true)
    public WalletBalanceResponse getBalance(Long playerId) {
        Wallet wallet = walletRepository.findById(playerId)
                .orElseThrow(() -> new WalletNotFoundException("Wallet not found for player: " + playerId));

        long availableBalance = wallet.getBalance() - wallet.getFrozenAmount();
        return new WalletBalanceResponse(wallet.getBalance(), wallet.getFrozenAmount(), availableBalance);
    }
}
