package com.luckystar.wallet.service;

import com.luckystar.wallet.postgres.entity.DiamondWallet;
import com.luckystar.wallet.postgres.repository.DiamondWalletRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 鑽石錢包開戶（T-101）。
 *
 * <p>與 {@link WalletService#createWallet(Long)}（星幣開戶，T-020）邏輯平行：消費
 * {@code member.registered} 事件時，為新玩家建立 {@code diamond_wallets} 記錄
 * （balance=0、version=0）。刻意與星幣 {@link WalletService} 分開，讓鑽石邏輯獨立演進。
 *
 * <p>冪等性由兩層保證：先以 {@code existsById} 預檢避免重複建立；若兩個 consumer 並發
 * 同時通過預檢，PostgreSQL 主鍵唯一約束會擋下後到者（{@link DataIntegrityViolationException}），
 * 此處吞掉該例外即可——對「同一 playerId 不重複建立」而言，重送/並發都是安全的 no-op。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DiamondWalletService {

    private final DiamondWalletRepository diamondWalletRepository;

    @Transactional(transactionManager = "postgresTransactionManager")
    public void createDiamondWallet(Long playerId) {
        if (diamondWalletRepository.existsById(playerId)) {
            log.warn("Diamond wallet already exists for playerId={}, skipping creation", playerId);
            return;
        }
        DiamondWallet wallet = DiamondWallet.builder()
                .playerId(playerId)
                .balance(0L)
                .version(0L)
                .build();
        try {
            diamondWalletRepository.saveAndFlush(wallet);
            log.info("Diamond wallet created for playerId={}", playerId);
        } catch (DataIntegrityViolationException e) {
            log.warn("Concurrent diamond wallet creation detected for playerId={}, ignoring", playerId);
        }
    }
}
