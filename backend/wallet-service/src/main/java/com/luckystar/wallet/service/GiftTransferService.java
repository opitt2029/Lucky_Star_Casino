package com.luckystar.wallet.service;

import com.luckystar.wallet.exception.InsufficientBalanceException;
import com.luckystar.wallet.exception.WalletNotFoundException;
import com.luckystar.wallet.postgres.entity.Wallet;
import com.luckystar.wallet.postgres.entity.WalletTransaction;
import com.luckystar.wallet.postgres.repository.WalletRepository;
import com.luckystar.wallet.postgres.repository.WalletTransactionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 好友贈幣的「原子轉帳」核心（T-026）。
 *
 * <p>本類別<b>只</b>負責 PostgreSQL 一筆交易內的雙向帳務異動（這是整個贈送流程裡唯一的金流真相）：
 * <ol>
 *   <li>載入贈送方錢包、餘額守衛（不足丟 {@link InsufficientBalanceException} → 422）。</li>
 *   <li>載入接收方錢包（任一方不存在丟 {@link WalletNotFoundException} → 404）。</li>
 *   <li>贈送方 balance 減、接收方 balance 加；兩個 {@code @Version} 錢包 save，並發衝突丟
 *       {@link org.springframework.orm.ObjectOptimisticLockingFailureException} → 409。</li>
 *   <li>寫兩筆流水：DEBIT/GIFT（贈送方）、CREDIT/GIFT（接收方），各帶不同 idempotencyKey。</li>
 * </ol>
 * 以上全在 {@code postgresTransactionManager} 一筆交易內，commit 才生效；任何例外整筆回滾。
 *
 * <p>Redis 當日額度預扣／回補、gift_logs 稽核寫入、Kafka 事件發布等「轉帳前後」的步驟<b>不在</b>本交易內，
 * 由 {@link GiftService} 在交易外協調（best-effort，見該類別）。獨立成 bean 是為了讓
 * {@code @Transactional} proxy 生效（同類別內 self-invocation 不會套用交易）。
 */
@Service
@RequiredArgsConstructor
public class GiftTransferService {

    private final WalletRepository walletRepository;
    private final WalletTransactionRepository walletTransactionRepository;

    /**
     * 在單一 PostgreSQL 交易內完成雙向轉帳並寫兩筆分錄。
     *
     * @param senderId    贈送方
     * @param receiverId  接收方（呼叫端已保證 ≠ senderId）
     * @param amount      金額（>0）
     * @param debitKey    贈送方分錄的冪等鍵（UNIQUE）
     * @param creditKey   接收方分錄的冪等鍵（UNIQUE）
     * @return 兩筆已存檔的分錄
     */
    @Transactional(transactionManager = "postgresTransactionManager")
    public Result transfer(Long senderId, Long receiverId, long amount, String debitKey, String creditKey) {
        Wallet sender = walletRepository.findById(senderId)
                .orElseThrow(() -> new WalletNotFoundException("Wallet not found for sender: " + senderId));

        if (sender.getBalance() < amount) {
            throw new InsufficientBalanceException("Insufficient balance");
        }

        Wallet receiver = walletRepository.findById(receiverId)
                .orElseThrow(() -> new WalletNotFoundException("Wallet not found for receiver: " + receiverId));

        long senderBefore = sender.getBalance();
        long receiverBefore = receiver.getBalance();
        sender.setBalance(senderBefore - amount);
        receiver.setBalance(receiverBefore + amount);

        // 樂觀鎖存檔：並發衝突丟 ObjectOptimisticLockingFailureException → GlobalExceptionHandler 轉 409
        walletRepository.save(sender);
        walletRepository.save(receiver);

        // 寫兩筆分錄；若同一 idempotencyKey 並發重入，DB UNIQUE 會擋下 → DataIntegrityViolationException
        // 整筆交易回滾，由 GiftService 回補 Redis 並以冪等命中回應。
        WalletTransaction debit = walletTransactionRepository.save(WalletTransaction.builder()
                .playerId(senderId)
                .type("DEBIT")
                .subType("GIFT")
                .amount(amount)
                .balanceBefore(senderBefore)
                .balanceAfter(sender.getBalance())
                .idempotencyKey(debitKey)
                .referenceId("gift-to:" + receiverId)
                .build());

        WalletTransaction credit = walletTransactionRepository.save(WalletTransaction.builder()
                .playerId(receiverId)
                .type("CREDIT")
                .subType("GIFT")
                .amount(amount)
                .balanceBefore(receiverBefore)
                .balanceAfter(receiver.getBalance())
                .idempotencyKey(creditKey)
                .referenceId("gift-from:" + senderId)
                .build());

        return new Result(debit, credit);
    }

    /** 轉帳結果：兩筆已存檔的分錄。 */
    public record Result(WalletTransaction debit, WalletTransaction credit) {}
}
