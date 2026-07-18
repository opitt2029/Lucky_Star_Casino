package com.luckystar.wallet.containers;

import com.luckystar.wallet.dto.DebitRequest;
import com.luckystar.wallet.exception.InsufficientBalanceException;
import com.luckystar.wallet.postgres.entity.Wallet;
import com.luckystar.wallet.postgres.repository.WalletRepository;
import com.luckystar.wallet.postgres.repository.WalletTransactionRepository;
import com.luckystar.wallet.service.WalletService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.orm.ObjectOptimisticLockingFailureException;

import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 樂觀鎖（wallets.version，AGENTS.md 雷區 8）在「真 PostgreSQL」下的防超扣驗證。
 *
 * <p>H2 也有 @Version 機制，但鎖與 MVCC 語意跟真 PG 不同（真 PG 是
 * UPDATE ... WHERE version=? 撞行鎖後 rowcount=0）；本測試在真 PG 上驗證：
 * 併發扣款最多一方成功、餘額絕不為負、輸家收到可辨識的例外。
 */
class WalletOptimisticLockContainerTest extends AbstractDualDatasourceContainerTest {

    private static final Long PLAYER = 920001L;

    @Autowired WalletService walletService;
    @Autowired WalletRepository walletRepository;
    @Autowired WalletTransactionRepository walletTransactionRepository;

    @BeforeEach
    void setUp() {
        cleanUp();
        walletRepository.save(Wallet.builder()
                .playerId(PLAYER).balance(1000L).frozenAmount(0L).version(0L)
                .build());
    }

    @AfterEach
    void cleanUp() {
        walletTransactionRepository.findAll().stream()
                .filter(tx -> PLAYER.equals(tx.getPlayerId()))
                .forEach(walletTransactionRepository::delete);
        walletRepository.findById(PLAYER).ifPresent(walletRepository::delete);
    }

    @Test
    void staleVersionSave_throwsOptimisticLockingFailure() {
        // 兩份 detached 快照（版本相同）→ 先存者版本 +1，後存者帶舊版本 → 必須被拒
        Wallet first = walletRepository.findById(PLAYER).orElseThrow();
        Wallet stale = walletRepository.findById(PLAYER).orElseThrow();

        first.setBalance(900L);
        walletRepository.saveAndFlush(first);

        stale.setBalance(800L);
        assertThatThrownBy(() -> walletRepository.saveAndFlush(stale))
                .isInstanceOf(ObjectOptimisticLockingFailureException.class);

        assertThat(walletRepository.findById(PLAYER).orElseThrow().getBalance()).isEqualTo(900L);
    }

    @Test
    void concurrentDebits_neverOverdraw() throws Exception {
        // 餘額 1000，兩個併發 800 扣款（不同冪等鍵）→ 最多一方成功；
        // T-090 B2 後 debit 走條件 UPDATE：輸家由行鎖序列化後守衛重評估 → 餘額不足
        // （不再拋樂觀鎖 409；catch 仍保留兩型以相容），餘額恆 = 1000 - 800 * 成功數 ≥ 0。
        int threads = 2;
        long debitAmount = 800L;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger success = new AtomicInteger();
        AtomicInteger expectedFailures = new AtomicInteger();

        try {
            List<Callable<Void>> tasks = List.of(
                    debitTask(start, "containers-lock-a", debitAmount, success, expectedFailures),
                    debitTask(start, "containers-lock-b", debitAmount, success, expectedFailures));
            List<Future<Void>> futures = tasks.stream().map(pool::submit).toList();
            start.countDown();
            for (Future<?> f : futures) {
                f.get(30, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }

        assertThat(success.get()).isEqualTo(1);
        assertThat(expectedFailures.get()).isEqualTo(threads - 1);

        Wallet wallet = walletRepository.findById(PLAYER).orElseThrow();
        assertThat(wallet.getBalance()).isEqualTo(1000L - debitAmount);
        assertThat(wallet.getBalance()).isNotNegative();

        long txCount = walletTransactionRepository.findAll().stream()
                .filter(tx -> PLAYER.equals(tx.getPlayerId()))
                .count();
        assertThat(txCount).isEqualTo(1);
    }

    private Callable<Void> debitTask(CountDownLatch start, String idempotencyKey, long amount,
                                     AtomicInteger success, AtomicInteger expectedFailures) {
        return () -> {
            start.await();
            DebitRequest req = new DebitRequest();
            req.setPlayerId(PLAYER);
            req.setAmount(amount);
            req.setIdempotencyKey(idempotencyKey);
            try {
                walletService.debit(req);
                success.incrementAndGet();
            } catch (ObjectOptimisticLockingFailureException | InsufficientBalanceException e) {
                expectedFailures.incrementAndGet();
            }
            return null;
        };
    }
}
