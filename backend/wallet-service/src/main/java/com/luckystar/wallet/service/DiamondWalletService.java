package com.luckystar.wallet.service;

import com.luckystar.wallet.exception.DiamondWalletNotFoundException;
import com.luckystar.wallet.exception.InsufficientDiamondException;
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

    /**
     * 鑽石入帳（T-102）。點數卡兌換流程的 PostgreSQL 寫端步驟：把面額加進玩家鑽石餘額，回傳入帳後餘額。
     *
     * <p>鑽石只增不需餘額守衛；{@code @Version} 樂觀鎖防並發超帳，衝突丟
     * {@link org.springframework.orm.ObjectOptimisticLockingFailureException} → GlobalExceptionHandler 轉 409。
     * 防重複兌換的關卡在序號（{@link DiamondCardService#redeemCard}），不在此處。
     *
     * @return 入帳後的鑽石總餘額
     * @throws DiamondWalletNotFoundException 鑽石錢包不存在 → 404
     */
    @Transactional(transactionManager = "postgresTransactionManager")
    public long creditDiamond(Long playerId, long amount) {
        DiamondWallet wallet = diamondWalletRepository.findById(playerId)
                .orElseThrow(() -> new DiamondWalletNotFoundException(
                        "Diamond wallet not found for player: " + playerId));
        wallet.setBalance(wallet.getBalance() + amount);
        diamondWalletRepository.save(wallet);
        log.info("Diamond credited: playerId={} amount={} balanceAfter={}",
                playerId, amount, wallet.getBalance());
        return wallet.getBalance();
    }

    /**
     * 查詢鑽石餘額（T-104）。唯讀查詢，不加悲觀鎖。
     *
     * @return 鑽石餘額
     * @throws DiamondWalletNotFoundException 鑽石錢包不存在 → 404
     */
    @Transactional(transactionManager = "postgresTransactionManager", readOnly = true)
    public long getBalance(Long playerId) {
        return diamondWalletRepository.findById(playerId)
                .orElseThrow(() -> new DiamondWalletNotFoundException(
                        "Diamond wallet not found for player: " + playerId))
                .getBalance();
    }

    /**
     * 鑽石扣款（T-103）。鑽石換星幣流程的 PostgreSQL 寫端步驟：驗證餘額後以樂觀鎖扣除鑽石餘額，回傳扣除後餘額。
     *
     * <p>餘額不足丟 {@link InsufficientDiamondException} → 422。
     * 並發樂觀鎖衝突丟 {@link org.springframework.orm.ObjectOptimisticLockingFailureException} → 409。
     *
     * @return 扣款後的鑽石餘額
     * @throws DiamondWalletNotFoundException 鑽石錢包不存在 → 404
     * @throws InsufficientDiamondException 鑽石餘額不足 → 422
     */
    @Transactional(transactionManager = "postgresTransactionManager")
    public long debitDiamond(Long playerId, long amount) {
        DiamondWallet wallet = diamondWalletRepository.findById(playerId)
                .orElseThrow(() -> new DiamondWalletNotFoundException(
                        "Diamond wallet not found for player: " + playerId));
        if (wallet.getBalance() < amount) {
            throw new InsufficientDiamondException(
                    "Insufficient diamond balance: required=" + amount + " available=" + wallet.getBalance());
        }
        wallet.setBalance(wallet.getBalance() - amount);
        diamondWalletRepository.save(wallet);
        log.info("Diamond debited: playerId={} amount={} balanceAfter={}",
                playerId, amount, wallet.getBalance());
        return wallet.getBalance();
    }
}
