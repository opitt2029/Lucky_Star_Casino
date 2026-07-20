package com.luckystar.wallet.containers;

import com.luckystar.wallet.dto.DebitRequest;
import com.luckystar.wallet.dto.DebitResponse;
import com.luckystar.wallet.exception.InsufficientBalanceException;
import com.luckystar.wallet.postgres.entity.Wallet;
import com.luckystar.wallet.postgres.entity.WalletTransaction;
import com.luckystar.wallet.postgres.repository.WalletRepository;
import com.luckystar.wallet.postgres.repository.WalletTransactionRepository;
import com.luckystar.wallet.service.WalletService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * T-090 B2（debit 熱路徑 4→2 往返）在「真 PostgreSQL」下的語意守門
 * （設計紀錄：docs/performance/T-090-B2-debit-roundtrip-design.md）。
 *
 * <p>H2 測不到的部分正是 B2 的風險所在：條件 UPDATE 的行鎖序列化、
 * NOT EXISTS 在 READ COMMITTED / EvalPlanQual 下的重評估、
 * INSERT ... ON CONFLICT 的原子冪等判定。本測試逐一驗證：
 * 冪等重放只扣一次、併發同鍵恰一筆流水、併發異鍵絕不超扣、餘額鏈連續。
 */
class WalletDebitRoundTripContainerTest extends AbstractDualDatasourceContainerTest {

    private static final Long PLAYER = 930001L;

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

    private DebitRequest request(long amount, String key) {
        DebitRequest req = new DebitRequest();
        req.setPlayerId(PLAYER);
        req.setAmount(amount);
        req.setIdempotencyKey(key);
        return req;
    }

    private long playerTxCount() {
        return walletTransactionRepository.findAll().stream()
                .filter(tx -> PLAYER.equals(tx.getPlayerId()))
                .count();
    }

    @Test
    void replay_returnsOriginalResultAndDeductsOnlyOnce() {
        DebitResponse first = walletService.debit(request(300L, "b2-replay"));
        assertThat(first.isIdempotent()).isFalse();
        assertThat(first.getBalanceBefore()).isEqualTo(1000L);
        assertThat(first.getBalanceAfter()).isEqualTo(700L);

        // 重放（原交易已 commit）：NOT EXISTS 預檢擋在往返 1 → 零副作用回原結果
        DebitResponse replay = walletService.debit(request(300L, "b2-replay"));
        assertThat(replay.isIdempotent()).isTrue();
        assertThat(replay.getTransactionId()).isEqualTo(first.getTransactionId());
        assertThat(replay.getBalanceBefore()).isEqualTo(1000L);
        assertThat(replay.getBalanceAfter()).isEqualTo(700L);

        assertThat(walletRepository.findById(PLAYER).orElseThrow().getBalance()).isEqualTo(700L);
        assertThat(playerTxCount()).isEqualTo(1);
    }

    @Test
    void replay_withTamperedAmount_returnsStoredValues() {
        DebitResponse first = walletService.debit(request(300L, "b2-tamper"));

        // 重放帶不同金額：仍回原始交易數值、不再扣款
        DebitResponse replay = walletService.debit(request(999L, "b2-tamper"));
        assertThat(replay.isIdempotent()).isTrue();
        assertThat(replay.getAmount()).isEqualTo(300L);
        assertThat(replay.getTransactionId()).isEqualTo(first.getTransactionId());
        assertThat(walletRepository.findById(PLAYER).orElseThrow().getBalance()).isEqualTo(700L);
        assertThat(playerTxCount()).isEqualTo(1);
    }

    @Test
    void concurrentSameKey_exactlyOneLedgerRow_loserGetsWinnerRecord() throws Exception {
        // 兩執行緒同鍵同時扣款：無論輸家走「NOT EXISTS 重評估」或「ON CONFLICT + 補償」路徑,
        // 都必須恰好一筆流水、恰好扣一次、雙方拿到同一 transactionId。
        int threads = 2;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<DebitResponse>> futures = new ArrayList<>();

        try {
            for (int i = 0; i < threads; i++) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return walletService.debit(request(300L, "b2-race"));
                }));
            }
            start.countDown();

            List<DebitResponse> responses = new ArrayList<>();
            for (Future<DebitResponse> f : futures) {
                responses.add(f.get(30, TimeUnit.SECONDS));
            }

            long fresh = responses.stream().filter(r -> !r.isIdempotent()).count();
            long replays = responses.stream().filter(DebitResponse::isIdempotent).count();
            assertThat(fresh).isEqualTo(1);
            assertThat(replays).isEqualTo(1);
            assertThat(responses.get(0).getTransactionId())
                    .isEqualTo(responses.get(1).getTransactionId());
        } finally {
            pool.shutdownNow();
        }

        assertThat(walletRepository.findById(PLAYER).orElseThrow().getBalance()).isEqualTo(700L);
        assertThat(playerTxCount()).isEqualTo(1);
    }

    @Test
    void concurrentDifferentKeys_rowLockSerializes_neverOverdraws() throws Exception {
        // 餘額 1000、10 個併發 300 扣款（各自不同鍵）：行鎖序列化後守衛重評估，
        // 恰好 3 筆成功、7 筆餘額不足——不再有樂觀鎖 409 的非決定性重試。
        int threads = 10;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger success = new AtomicInteger();
        AtomicInteger insufficient = new AtomicInteger();

        try {
            List<Future<Void>> futures = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                String key = "b2-multi-" + i;
                futures.add(pool.submit((Callable<Void>) () -> {
                    start.await();
                    try {
                        walletService.debit(request(300L, key));
                        success.incrementAndGet();
                    } catch (InsufficientBalanceException e) {
                        insufficient.incrementAndGet();
                    }
                    return null;
                }));
            }
            start.countDown();
            for (Future<?> f : futures) {
                f.get(30, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }

        assertThat(success.get()).isEqualTo(3);
        assertThat(insufficient.get()).isEqualTo(7);

        Wallet wallet = walletRepository.findById(PLAYER).orElseThrow();
        assertThat(wallet.getBalance()).isEqualTo(100L);
        assertThat(playerTxCount()).isEqualTo(3);
    }

    @Test
    void sequentialDebits_balanceChainIsContinuous() {
        walletService.debit(request(100L, "b2-chain-1"));
        walletService.debit(request(200L, "b2-chain-2"));
        walletService.debit(request(300L, "b2-chain-3"));

        List<WalletTransaction> txs = walletTransactionRepository.findAll().stream()
                .filter(tx -> PLAYER.equals(tx.getPlayerId()))
                .sorted((a, b) -> a.getId().compareTo(b.getId()))
                .toList();

        assertThat(txs).hasSize(3);
        assertThat(txs.get(0).getBalanceBefore()).isEqualTo(1000L);
        assertThat(txs.get(0).getBalanceAfter()).isEqualTo(900L);
        assertThat(txs.get(1).getBalanceBefore()).isEqualTo(900L);
        assertThat(txs.get(1).getBalanceAfter()).isEqualTo(700L);
        assertThat(txs.get(2).getBalanceBefore()).isEqualTo(700L);
        assertThat(txs.get(2).getBalanceAfter()).isEqualTo(400L);
        assertThat(txs).allSatisfy(tx -> {
            assertThat(tx.getType()).isEqualTo("DEBIT");
            assertThat(tx.getSubType()).isEqualTo("BET");
        });

        assertThat(walletRepository.findById(PLAYER).orElseThrow().getBalance()).isEqualTo(400L);
    }
}
