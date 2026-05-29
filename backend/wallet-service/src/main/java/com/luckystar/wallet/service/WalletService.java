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

    @Transactional(transactionManager = "postgresTransactionManager")
    public CreditResponse credit(CreditRequest request) {
        // Step 1: idempotency check — return existing transaction without any side effects
        var existing = walletTransactionRepository.findByIdempotencyKey(request.getIdempotencyKey());
        if (existing.isPresent()) {
            WalletTransaction tx = existing.get();
            return CreditResponse.builder()
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

        // Step 3: snapshot balance
        long balanceBefore = wallet.getBalance();

        // Step 4: credit balance
        wallet.setBalance(wallet.getBalance() + request.getAmount());

        // Step 5: release frozen amount, never below zero
        long newFrozen = Math.max(0L, wallet.getFrozenAmount() - request.getAmount());
        wallet.setFrozenAmount(newFrozen);

        // Step 6: persist wallet — ObjectOptimisticLockingFailureException propagates as-is → 409
        walletRepository.save(wallet);

        // Step 7: persist transaction record
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
            // Two concurrent requests with the same idempotencyKey both passed the Step 1 check.
            // The DB UNIQUE constraint blocked the second insert — re-query and return the winner's record.
            return walletTransactionRepository.findByIdempotencyKey(request.getIdempotencyKey())
                    .map(winner -> CreditResponse.builder()
                            .transactionId(winner.getId())
                            .playerId(winner.getPlayerId())
                            .amount(winner.getAmount())
                            .balanceBefore(winner.getBalanceBefore())
                            .balanceAfter(winner.getBalanceAfter())
                            .idempotent(true)
                            .build())
                    .orElseThrow(() -> e);
        }

        // Step 8: publish Kafka event — best-effort, credit already committed
        try {
            WalletCreditEvent event = new WalletCreditEvent(
                    tx.getId(),
                    tx.getPlayerId(),
                    tx.getAmount(),
                    tx.getBalanceBefore(),
                    tx.getBalanceAfter(),
                    tx.getIdempotencyKey(),
                    tx.getReferenceId());
            String payload = objectMapper.writeValueAsString(event);
            kafkaTemplate.send("wallet.credit", String.valueOf(request.getPlayerId()), payload);
        } catch (JsonProcessingException e) {
            log.warn("Failed to serialize WalletCreditEvent for transactionId={}", tx.getId(), e);
        } catch (Exception e) {
            log.warn("Failed to publish wallet.credit event for transactionId={}", tx.getId(), e);
        }

        // Step 9: return response
        return CreditResponse.builder()
                .transactionId(tx.getId())
                .playerId(tx.getPlayerId())
                .amount(tx.getAmount())
                .balanceBefore(tx.getBalanceBefore())
                .balanceAfter(tx.getBalanceAfter())
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
