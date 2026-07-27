package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.CreditRequest;
import com.luckystar.wallet.dto.CreditResponse;
import com.luckystar.wallet.dto.DebitRequest;
import com.luckystar.wallet.dto.DebitResponse;
import com.luckystar.wallet.dto.WalletBalanceResponse;
import com.luckystar.wallet.exception.InsufficientBalanceException;
import com.luckystar.wallet.exception.WalletNotFoundException;
import com.luckystar.wallet.kafka.WalletCreditEvent;
import com.luckystar.wallet.kafka.WalletDebitEvent;
import com.luckystar.wallet.postgres.entity.Wallet;
import com.luckystar.wallet.postgres.entity.WalletTransaction;
import com.luckystar.wallet.postgres.repository.WalletDebitDao;
import com.luckystar.wallet.postgres.repository.WalletRepository;
import com.luckystar.wallet.postgres.repository.WalletTransactionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class WalletService {

    private final WalletRepository walletRepository;
    private final WalletTransactionRepository walletTransactionRepository;
    private final WalletDebitDao walletDebitDao;
    private final WalletOutboxService walletOutboxService;

    @Transactional(readOnly = true, transactionManager = "postgresTransactionManager")
    public WalletBalanceResponse getBalance(Long playerId) {
        Wallet wallet = walletRepository.findById(playerId)
                .orElseThrow(() -> new WalletNotFoundException("Wallet not found for player: " + playerId));

        long balance = wallet.getBalance();
        long frozenAmount = wallet.getFrozenAmount();
        if (frozenAmount > balance) {
            log.error("Data inconsistency: frozenAmount={} > balance={} for playerId={}",
                    frozenAmount, balance, playerId);
        }
        long availableBalance = Math.max(0L, balance - frozenAmount);
        return new WalletBalanceResponse(balance, frozenAmount, availableBalance);
    }

    /**
     * 下注扣款（T-090 B2 改版：熱路徑 2 次 DB 往返，設計紀錄見
     * docs/performance/T-090-B2-debit-roundtrip-design.md）。
     *
     * <p>冪等與防超扣語意與舊版（4 往返讀改寫）完全等價，差別只在原子性搬進 SQL 語句：
     * <ol>
     *   <li><b>往返 1</b>：條件 UPDATE 一次完成冪等預檢＋可用餘額守衛＋扣款＋version 遞增，
     *       RETURNING 取回扣款後餘額；0 列＝冷路徑（冪等命中/404/餘額不足，補查區分，皆零副作用）。</li>
     *   <li><b>往返 2</b>：INSERT 流水（ON CONFLICT 原子判定冪等鍵）；空＝極窄併發同鍵競態
     *       （兩請求同時通過往返 1 預檢）→ 同交易內原地補償回沖、回查贏家紀錄回 idempotent=true。</li>
     * </ol>
     *
     * <p>行為差異（有意為之）：debit 不再拋 ObjectOptimisticLockingFailureException——併發爭搶
     * 由 wallets 行鎖序列化，後到者夠扣就成功、不夠拋 InsufficientBalanceException；併發同鍵
     * 重複請求後到者回贏家結果而非 409。其他寫入方（credit/gift）仍走 JPA {@code @Version}，
     * 本方法每次扣款 version+1，對它們的樂觀鎖防護不變。
     */
    @Transactional(transactionManager = "postgresTransactionManager")
    public DebitResponse debit(DebitRequest request) {
        long amount = request.getAmount();
        String key = request.getIdempotencyKey();
        // subType 選填：未帶（如 game-service 下注）預設 BET，商城兌換帶 SHOP_PURCHASE
        String subType = request.getSubType() != null ? request.getSubType() : "BET";

        // 往返 1：條件扣款（冪等預檢＋餘額守衛＋扣款＋version 遞增，單一原子語句）
        var deducted = walletDebitDao.deductIfSufficientAndKeyUnused(request.getPlayerId(), amount, key);
        if (deducted.isEmpty()) {
            // 冷路徑（零副作用）：依序區分冪等命中 → 錢包不存在 → 餘額不足
            var existing = walletTransactionRepository.findByIdempotencyKey(key);
            if (existing.isPresent()) {
                return toIdempotentResponse(existing.get(), request);
            }
            walletRepository.findById(request.getPlayerId())
                    .orElseThrow(() -> new WalletNotFoundException(
                            "Wallet not found for player: " + request.getPlayerId()));
            throw new InsufficientBalanceException("Insufficient balance");
        }

        long balanceAfter = deducted.get();
        long balanceBefore = balanceAfter + amount;

        // 往返 2：寫流水；空＝併發同鍵競態（雙方都通過了往返 1 的 NOT EXISTS 預檢）
        var txId = walletDebitDao.insertDebitTransaction(
                request.getPlayerId(), subType, amount, balanceBefore, balanceAfter,
                key, request.getReferenceId());
        if (txId.isEmpty()) {
            // 原地補償回沖（淨額歸零、不多寫流水），再回查贏家紀錄。不 rollback：
            // debit 可能 join 外層交易（商城兌換），丟例外會把外層整筆拖垮。
            walletDebitDao.restoreBalance(request.getPlayerId(), amount);
            return walletTransactionRepository.findByIdempotencyKey(key)
                    .map(tx -> toIdempotentResponse(tx, request))
                    .orElseThrow(() -> new IllegalStateException(
                            "Idempotency conflict detected but winner transaction not found, key=" + key));
        }

        // 藍圖 04 P2：改走 Transactional Outbox。把 wallet.debit 事件寫進 wallet_outbox（同一交易、
        // 原子），由 WalletOutboxPoller 之後同步送達 broker——杜絕事件無聲丟失。
        // 注意 B2 的行鎖顧慮已消解：往返 1 起持有 wallets 行鎖，但 outbox 只是一筆同庫 INSERT，
        // 不觸發 broker I/O，不會拖住行鎖；且交易回滾時 outbox 列一起回滾，天然無「幽靈事件」。
        WalletDebitEvent event = new WalletDebitEvent(
                txId.get(),
                request.getPlayerId(),
                amount,
                balanceBefore,
                balanceAfter,
                subType,
                key,
                request.getReferenceId());
        walletOutboxService.save("wallet.debit", String.valueOf(request.getPlayerId()), event);

        return DebitResponse.builder()
                .transactionId(txId.get())
                .playerId(request.getPlayerId())
                .amount(amount)
                .balanceBefore(balanceBefore)
                .balanceAfter(balanceAfter)
                .idempotent(false)
                .build();
    }

    private DebitResponse toIdempotentResponse(WalletTransaction tx, DebitRequest request) {
        if (!tx.getPlayerId().equals(request.getPlayerId())) {
            // 冪等鍵跨玩家碰撞＝呼叫端鍵命名出 bug（正規鍵都以 playerId 為 namespace）。
            // 沿用舊版語意回原交易值，但大聲留痕，讓碰撞可被監控發現而非無聲吞掉。
            log.error("Idempotency key collision across players: key={} requestPlayerId={} txPlayerId={}",
                    tx.getIdempotencyKey(), request.getPlayerId(), tx.getPlayerId());
        }
        return DebitResponse.builder()
                .transactionId(tx.getId())
                .playerId(tx.getPlayerId())
                .amount(tx.getAmount())
                .balanceBefore(tx.getBalanceBefore())
                .balanceAfter(tx.getBalanceAfter())
                .idempotent(true)
                .build();
    }

    /**
     * 派彩 / 入帳（T-023）。供內部呼叫（如 game-service 派彩、簽到/任務發獎）。
     *
     * <p>整體流程與 {@link #debit(DebitRequest)} 對稱，差別在於：credit 是加錢，不需餘額守衛；
     * 並可選擇性解凍先前下注凍結的金額。冪等與並發防護沿用同一套設計：
     * <ol>
     *   <li><b>冪等檢查</b>：先用 idempotencyKey 查流水，已存在就直接回傳原結果、完全不再加錢
     *       （避免 Kafka 重送、呼叫方 retry 造成重複入帳）。</li>
     *   <li><b>載入錢包</b>：找不到錢包丟 {@link WalletNotFoundException} → 404。</li>
     *   <li><b>加餘額 +（選填）解凍</b>：balance 增加 amount；若有 unfreezeAmount 則釋放凍結金額
     *       （以 max(0, ...) 守衛，避免凍結金額變負數）。</li>
     *   <li><b>樂觀鎖存檔</b>：Wallet 有 {@code @Version}，並發更新衝突會丟
     *       {@link org.springframework.orm.ObjectOptimisticLockingFailureException} → 由 GlobalExceptionHandler 轉 409。</li>
     *   <li><b>寫流水</b>：type=CREDIT、subType 由請求帶入；若兩個並發請求帶同一 idempotencyKey 同時通過
     *       Step 1，DB 的 UNIQUE 約束會擋下第二筆（{@link DataIntegrityViolationException}），此時改回查並回傳贏家紀錄。</li>
     *   <li><b>發 Kafka wallet.credit 事件</b>：best-effort，餘額已 commit，發送失敗只記 log 不回滾
     *       （與 debit 一致；若要「絕不丟事件」需改用 Outbox Pattern，屬後續優化）。</li>
     * </ol>
     *
     * <p>⚠️ 此處發布的 wallet.credit 是「已入帳通知」語意。關於它與 member-service 把 wallet.credit
     * 當「請入帳指令」的衝突，見 {@link WalletCreditEvent} 的備註與 docs/_TMP_wallet-credit-架構決策筆記.md。
     */
    @Transactional(transactionManager = "postgresTransactionManager")
    public CreditResponse credit(CreditRequest request) {
        // Step 1: 冪等檢查 — 同一個 idempotencyKey 已入過帳就直接回傳原結果，不產生任何副作用
        var existing = walletTransactionRepository.findByIdempotencyKey(request.getIdempotencyKey());
        if (existing.isPresent()) {
            WalletTransaction tx = existing.get();
            return CreditResponse.builder()
                    .transactionId(tx.getId())
                    .playerId(tx.getPlayerId())
                    .amount(tx.getAmount())
                    .balanceBefore(tx.getBalanceBefore())
                    .balanceAfter(tx.getBalanceAfter())
                    .frozenAfter(null) // 冪等命中不重算凍結；以當初入帳結果為準
                    .idempotent(true)
                    .build();
        }

        // Step 2: 載入錢包
        Wallet wallet = walletRepository.findById(request.getPlayerId())
                .orElseThrow(() -> new WalletNotFoundException(
                        "Wallet not found for player: " + request.getPlayerId()));

        // Step 3: 加餘額（credit 不需餘額守衛，因為是加錢）
        long balanceBefore = wallet.getBalance();
        wallet.setBalance(balanceBefore + request.getAmount());

        // Step 3b: 選填解凍 — 釋放先前下注凍結的金額；守衛確保凍結金額不會被扣成負數
        long unfreeze = request.getUnfreezeAmount() == null ? 0L : request.getUnfreezeAmount();
        if (unfreeze > 0) {
            if (unfreeze > wallet.getFrozenAmount()) {
                log.warn("Unfreeze amount {} exceeds frozenAmount {} for playerId={}, clamping to 0",
                        unfreeze, wallet.getFrozenAmount(), request.getPlayerId());
            }
            wallet.setFrozenAmount(Math.max(0L, wallet.getFrozenAmount() - unfreeze));
        }

        // Step 4: 樂觀鎖存檔 — 並發衝突丟 ObjectOptimisticLockingFailureException → 409，原樣往外拋
        walletRepository.save(wallet);

        // Step 5: 寫入帳流水
        WalletTransaction tx;
        try {
            WalletTransaction txToSave = WalletTransaction.builder()
                    .playerId(request.getPlayerId())
                    .type("CREDIT")
                    .subType(request.getSubType())
                    .amount(request.getAmount())
                    .balanceBefore(balanceBefore)
                    .balanceAfter(wallet.getBalance())
                    .idempotencyKey(request.getIdempotencyKey())
                    .referenceId(request.getReferenceId())
                    .build();
            tx = walletTransactionRepository.save(txToSave);
        } catch (DataIntegrityViolationException e) {
            // 兩個並發請求帶同一 idempotencyKey 同時通過 Step 1，DB UNIQUE 擋下第二筆 → 回查贏家紀錄
            return walletTransactionRepository.findByIdempotencyKey(request.getIdempotencyKey())
                    .map(winner -> CreditResponse.builder()
                            .transactionId(winner.getId())
                            .playerId(winner.getPlayerId())
                            .amount(winner.getAmount())
                            .balanceBefore(winner.getBalanceBefore())
                            .balanceAfter(winner.getBalanceAfter())
                            .frozenAfter(null)
                            .idempotent(true)
                            .build())
                    .orElseThrow(() -> e); // 理論上不會發生：約束觸發卻查不到紀錄
        }

        // Step 6: 藍圖 04 P2：改走 Transactional Outbox。把 wallet.credit 事件寫進 wallet_outbox
        // （與 Step 4/5 的錢包更新、流水寫入落在同一交易、原子），由 WalletOutboxPoller 之後送達
        // broker。序列化失敗（幾乎不可能，事件是簡單 record）由 WalletOutboxService 拋 → 交易回滾，
        // 寧可讓入帳失敗也不留無聲缺口。
        WalletCreditEvent event = new WalletCreditEvent(
                tx.getId(),
                tx.getPlayerId(),
                tx.getAmount(),
                tx.getBalanceBefore(),
                tx.getBalanceAfter(),
                tx.getSubType(),
                tx.getIdempotencyKey(),
                tx.getReferenceId());
        walletOutboxService.save("wallet.credit", String.valueOf(request.getPlayerId()), event);

        // Step 7: 回傳結果
        return CreditResponse.builder()
                .transactionId(tx.getId())
                .playerId(tx.getPlayerId())
                .amount(tx.getAmount())
                .balanceBefore(tx.getBalanceBefore())
                .balanceAfter(tx.getBalanceAfter())
                .frozenAfter(wallet.getFrozenAmount())
                .idempotent(false)
                .build();
    }

    @Transactional(transactionManager = "postgresTransactionManager")
    public void createWallet(Long playerId) {
        if (walletRepository.existsById(playerId)) {
            log.warn("Wallet already exists for playerId={}, skipping creation", playerId);
            return;
        }
        Wallet wallet = Wallet.builder()
                .playerId(playerId)
                .balance(0L)
                .frozenAmount(0L)
                .version(0L)
                .build();
        try {
            walletRepository.saveAndFlush(wallet);
            log.info("Wallet created for playerId={}", playerId);
        } catch (DataIntegrityViolationException e) {
            log.warn("Concurrent wallet creation detected for playerId={}, ignoring", playerId);
        }
    }
}
