package com.luckystar.wallet.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import com.luckystar.wallet.postgres.repository.WalletRepository;
import com.luckystar.wallet.postgres.repository.WalletTransactionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class WalletService {

    private final WalletRepository walletRepository;
    private final WalletTransactionRepository walletTransactionRepository;
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;

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

    @Transactional(transactionManager = "postgresTransactionManager")
    public DebitResponse debit(DebitRequest request) {
        // Step 1: idempotency check — return existing transaction without any side effects
        var existing = walletTransactionRepository.findByIdempotencyKey(request.getIdempotencyKey());
        if (existing.isPresent()) {
            WalletTransaction tx = existing.get();
            return DebitResponse.builder()
                    .transactionId(tx.getId())
                    .playerId(tx.getPlayerId())
                    .amount(tx.getAmount())
                    .balanceBefore(tx.getBalanceBefore())
                    .balanceAfter(tx.getBalanceAfter())
                    .idempotent(true)
                    .build();
        }

        // Step 2: load wallet
        Wallet wallet = walletRepository.findById(request.getPlayerId())
                .orElseThrow(() -> new WalletNotFoundException(
                        "Wallet not found for player: " + request.getPlayerId()));

        // Step 3: balance guard
        if (wallet.getBalance() < request.getAmount()) {
            throw new InsufficientBalanceException("Insufficient balance");
        }

        // Step 4-5: record and deduct
        long balanceBefore = wallet.getBalance();
        wallet.setBalance(wallet.getBalance() - request.getAmount());

        // Step 6: persist wallet — ObjectOptimisticLockingFailureException propagates as-is → 409
        walletRepository.save(wallet);

        // Step 7: persist transaction record
        WalletTransaction tx;
        try {
            WalletTransaction txToSave = WalletTransaction.builder()
                    .playerId(request.getPlayerId())
                    .type("DEBIT")
                    .subType("BET")
                    .amount(request.getAmount())
                    .balanceBefore(balanceBefore)
                    .balanceAfter(wallet.getBalance())
                    .idempotencyKey(request.getIdempotencyKey())
                    .referenceId(request.getReferenceId())
                    .build();
            tx = walletTransactionRepository.save(txToSave);
        } catch (DataIntegrityViolationException e) {
            // Two concurrent requests with the same idempotencyKey both passed the Step 1 check.
            // The DB UNIQUE constraint blocked the second insert — re-query and return the winner's record.
            return walletTransactionRepository.findByIdempotencyKey(request.getIdempotencyKey())
                    .map(winner -> DebitResponse.builder()
                            .transactionId(winner.getId())
                            .playerId(winner.getPlayerId())
                            .amount(winner.getAmount())
                            .balanceBefore(winner.getBalanceBefore())
                            .balanceAfter(winner.getBalanceAfter())
                            .idempotent(true)
                            .build())
                    .orElseThrow(() -> e); // should not happen: constraint fired, yet record not found
        }

        // Step 8: publish Kafka event — best-effort, debit already committed
        try {
            WalletDebitEvent event = new WalletDebitEvent(
                    tx.getId(),
                    tx.getPlayerId(),
                    tx.getAmount(),
                    tx.getBalanceBefore(),
                    tx.getBalanceAfter(),
                    tx.getSubType(),
                    tx.getIdempotencyKey(),
                    tx.getReferenceId());
            String payload = objectMapper.writeValueAsString(event);
            kafkaTemplate.send("wallet.debit", String.valueOf(request.getPlayerId()), payload);
        } catch (JsonProcessingException e) {
            log.warn("Failed to serialize WalletDebitEvent for transactionId={}", tx.getId(), e);
        } catch (Exception e) {
            log.warn("Failed to publish wallet.debit event for transactionId={}", tx.getId(), e);
        }

        // Step 9: return response
        return DebitResponse.builder()
                .transactionId(tx.getId())
                .playerId(tx.getPlayerId())
                .amount(tx.getAmount())
                .balanceBefore(tx.getBalanceBefore())
                .balanceAfter(tx.getBalanceAfter())
                .idempotent(false)
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

        // Step 6: 發 Kafka wallet.credit 事件（best-effort，入帳已 commit）
        try {
            WalletCreditEvent event = new WalletCreditEvent(
                    tx.getId(),
                    tx.getPlayerId(),
                    tx.getAmount(),
                    tx.getBalanceBefore(),
                    tx.getBalanceAfter(),
                    tx.getSubType(),
                    tx.getIdempotencyKey(),
                    tx.getReferenceId());
            String payload = objectMapper.writeValueAsString(event);
            kafkaTemplate.send("wallet.credit", String.valueOf(request.getPlayerId()), payload);
        } catch (JsonProcessingException e) {
            log.warn("Failed to serialize WalletCreditEvent for transactionId={}", tx.getId(), e);
        } catch (Exception e) {
            log.warn("Failed to publish wallet.credit event for transactionId={}", tx.getId(), e);
        }

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
