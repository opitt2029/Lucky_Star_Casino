package com.luckystar.wallet.containers;

import com.luckystar.wallet.dto.CreditRequest;
import com.luckystar.wallet.dto.DebitRequest;
import com.luckystar.wallet.postgres.entity.Wallet;
import com.luckystar.wallet.postgres.entity.WalletOutbox;
import com.luckystar.wallet.postgres.repository.WalletOutboxRepository;
import com.luckystar.wallet.postgres.repository.WalletRepository;
import com.luckystar.wallet.postgres.repository.WalletTransactionRepository;
import com.luckystar.wallet.service.WalletOutboxPoller;
import com.luckystar.wallet.service.WalletOutboxService;
import com.luckystar.wallet.service.WalletService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.kafka.support.SendResult;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.concurrent.CompletableFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 藍圖 04 P2 Outbox 在「真 PostgreSQL」下的守門（ADR-007）。
 *
 * <p>H2（ddl-auto=create 由 entity 反向建表）測不到的關鍵：
 * <ul>
 *   <li><b>entity ↔ 真 schema 漂移</b>：本測試以 ddl-auto=validate 對 database/postgres 的
 *       init.sql + migration V17 啟動——{@code wallet_outbox} 欄位不符會直接讓 context 起不來。</li>
 *   <li><b>真交易原子性</b>：outbox INSERT 與帳務異動同交易；rollback 時 outbox 列一起消失。</li>
 *   <li><b>BIGSERIAL id 生成 / TEXT payload</b>：真 PG 型別語意。</li>
 * </ul>
 * KafkaTemplate 由基底以 @MockBean 取代，故 poller 送達行為以 mock 驗證（焦點是 DB 語意）。
 */
class WalletOutboxContainerTest extends AbstractDualDatasourceContainerTest {

    private static final Long PLAYER = 940001L;

    @Autowired WalletService walletService;
    @Autowired WalletOutboxService walletOutboxService;
    @Autowired WalletOutboxPoller walletOutboxPoller;
    @Autowired WalletRepository walletRepository;
    @Autowired WalletTransactionRepository walletTransactionRepository;
    @Autowired WalletOutboxRepository walletOutboxRepository;
    @Autowired @Qualifier("postgresTransactionManager") PlatformTransactionManager txManager;

    @BeforeEach
    void setUp() {
        cleanUp();
        walletRepository.save(Wallet.builder()
                .playerId(PLAYER).balance(1000L).frozenAmount(0L).version(0L)
                .build());
    }

    @AfterEach
    void cleanUp() {
        // 清掉本測試 player 的 outbox / 流水 / 錢包（outbox 以 kafkaKey=playerId 過濾）
        walletOutboxRepository.findAll().stream()
                .filter(o -> String.valueOf(PLAYER).equals(o.getKafkaKey())
                        || "outbox-rollback".equals(o.getKafkaKey())
                        || "outbox-poll".equals(o.getKafkaKey()))
                .forEach(walletOutboxRepository::delete);
        walletTransactionRepository.findAll().stream()
                .filter(tx -> PLAYER.equals(tx.getPlayerId()))
                .forEach(walletTransactionRepository::delete);
        walletRepository.findById(PLAYER).ifPresent(walletRepository::delete);
    }

    private List<WalletOutbox> outboxFor(String kafkaKey) {
        return walletOutboxRepository.findAll().stream()
                .filter(o -> kafkaKey.equals(o.getKafkaKey()))
                .toList();
    }

    @Test
    void credit_writesPendingOutboxRow_inSameTransaction() {
        CreditRequest req = new CreditRequest();
        req.setPlayerId(PLAYER);
        req.setAmount(500L);
        req.setSubType("WIN");
        req.setIdempotencyKey("outbox-credit-1");

        walletService.credit(req);

        List<WalletOutbox> rows = outboxFor(String.valueOf(PLAYER)).stream()
                .filter(o -> "wallet.credit".equals(o.getTopic()))
                .toList();
        assertThat(rows).hasSize(1);
        WalletOutbox row = rows.get(0);
        assertThat(row.getId()).isNotNull(); // BIGSERIAL 生成
        assertThat(row.getStatus()).isEqualTo(WalletOutbox.STATUS_PENDING);
        assertThat(row.getRetryCount()).isZero();
        assertThat(row.getSentAt()).isNull();
        assertThat(row.getCreatedAt()).isNotNull();
        assertThat(row.getPayload()).contains("\"subType\":\"WIN\"").contains("\"amount\":500");
    }

    @Test
    void debit_writesPendingOutboxRow() {
        DebitRequest req = new DebitRequest();
        req.setPlayerId(PLAYER);
        req.setAmount(300L);
        req.setIdempotencyKey("outbox-debit-1");

        walletService.debit(req);

        List<WalletOutbox> rows = outboxFor(String.valueOf(PLAYER)).stream()
                .filter(o -> "wallet.debit".equals(o.getTopic()))
                .toList();
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getStatus()).isEqualTo(WalletOutbox.STATUS_PENDING);
    }

    @Test
    void outboxInsert_rollsBackWithTransaction() {
        // 在一個 PG 交易內寫 outbox 後主動丟例外 → 整筆回滾，outbox 列不應留下（原子性）
        TransactionTemplate tx = new TransactionTemplate(txManager);
        assertThatThrownBy(() -> tx.executeWithoutResult(status -> {
            walletOutboxService.save("wallet.credit", "outbox-rollback", new SamplePayload(PLAYER, 1L));
            throw new RuntimeException("force rollback");
        })).isInstanceOf(RuntimeException.class).hasMessage("force rollback");

        assertThat(outboxFor("outbox-rollback")).isEmpty();
    }

    @Test
    void poller_sendSucceeds_marksRowSent() {
        // 先落一筆 PENDING（自成一交易）
        TransactionTemplate tx = new TransactionTemplate(txManager);
        tx.executeWithoutResult(status ->
                walletOutboxService.save("wallet.credit", "outbox-poll", new SamplePayload(PLAYER, 2L)));
        assertThat(outboxFor("outbox-poll")).singleElement()
                .satisfies(o -> assertThat(o.getStatus()).isEqualTo(WalletOutbox.STATUS_PENDING));

        // 基底的 @MockBean KafkaTemplate：stub 送達成功
        @SuppressWarnings("unchecked")
        SendResult<String, String> sendResult = mock(SendResult.class);
        when(kafkaTemplate.send(anyString(), anyString(), anyString()))
                .thenReturn(CompletableFuture.completedFuture(sendResult));

        walletOutboxPoller.publishPendingEvents();

        assertThat(outboxFor("outbox-poll")).singleElement().satisfies(o -> {
            assertThat(o.getStatus()).isEqualTo(WalletOutbox.STATUS_SENT);
            assertThat(o.getSentAt()).isNotNull();
        });
    }

    private record SamplePayload(Long playerId, Long amount) {}
}
