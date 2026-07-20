package com.luckystar.wallet.postgres.repository;

import com.luckystar.wallet.postgres.entity.Wallet;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * WalletDebitDao 的 H2 方言分支直測（T-090 B2）。
 *
 * <p>WalletServiceDebitTest 把 DAO mock 掉（雷區 16 教訓：mock 蓋不到 SQL），
 * 此處在 H2 上直打 DAO，補齊兩個沒被整合測試觸到的分支：
 * H2 的 DuplicateKeyException → empty 分流、deduct 對缺席錢包/凍結守衛的 0 列路徑。
 * 真 PG 語法（RETURNING / ON CONFLICT）由 containers/WalletDebitRoundTripContainerTest 守門。
 */
@SpringBootTest
class WalletDebitDaoH2Test {

    private static final Long PLAYER = 940001L;

    @Autowired WalletDebitDao dao;
    @Autowired WalletRepository walletRepository;
    @Autowired WalletTransactionRepository walletTransactionRepository;

    @MockBean KafkaTemplate<String, String> kafkaTemplate;

    @BeforeEach
    void setUp() {
        cleanUp();
        walletRepository.save(Wallet.builder()
                .playerId(PLAYER).balance(1000L).frozenAmount(400L).version(0L)
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
    void deduct_respectsFrozenAmountGuard() {
        // 可用餘額 = 1000 - 400（凍結）= 600：601 擋下、600 放行
        assertThat(dao.deductIfSufficientAndKeyUnused(PLAYER, 601L, "dao-h2-guard-a")).isEmpty();
        Optional<Long> ok = dao.deductIfSufficientAndKeyUnused(PLAYER, 600L, "dao-h2-guard-b");
        assertThat(ok).contains(400L); // 扣款後 balance = 400（凍結不動）
    }

    @Test
    void deduct_missingWallet_returnsEmpty() {
        assertThat(dao.deductIfSufficientAndKeyUnused(888888L, 1L, "dao-h2-missing")).isEmpty();
    }

    @Test
    void deduct_usedIdempotencyKey_returnsEmptyWithoutDeducting() {
        dao.insertDebitTransaction(PLAYER, "BET", 100L, 1000L, 900L, "dao-h2-used", null);

        assertThat(dao.deductIfSufficientAndKeyUnused(PLAYER, 100L, "dao-h2-used")).isEmpty();
        assertThat(walletRepository.findById(PLAYER).orElseThrow().getBalance()).isEqualTo(1000L);
    }

    @Test
    void insert_duplicateKey_returnsEmptyInsteadOfThrowing() {
        Optional<Long> first = dao.insertDebitTransaction(PLAYER, "BET", 100L, 1000L, 900L, "dao-h2-dup", "r1");
        assertThat(first).isPresent();

        // H2 路徑：UNIQUE 違規被轉為 DuplicateKeyException 後吞掉 → empty（等價 PG 的 ON CONFLICT DO NOTHING）
        Optional<Long> second = dao.insertDebitTransaction(PLAYER, "BET", 100L, 900L, 800L, "dao-h2-dup", "r2");
        assertThat(second).isEmpty();

        long rows = walletTransactionRepository.findAll().stream()
                .filter(tx -> PLAYER.equals(tx.getPlayerId()))
                .count();
        assertThat(rows).isEqualTo(1);
    }

    @Test
    void restoreBalance_addsBackAndBumpsVersion() {
        Wallet before = walletRepository.findById(PLAYER).orElseThrow();
        dao.deductIfSufficientAndKeyUnused(PLAYER, 300L, "dao-h2-restore");

        dao.restoreBalance(PLAYER, 300L);

        Wallet after = walletRepository.findById(PLAYER).orElseThrow();
        assertThat(after.getBalance()).isEqualTo(before.getBalance());
        assertThat(after.getVersion()).isEqualTo(before.getVersion() + 2); // 扣款 +1、回沖 +1
    }
}
