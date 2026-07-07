package com.luckystar.wallet.containers;

import com.luckystar.wallet.mysql.entity.ShopItem;
import com.luckystar.wallet.mysql.repository.ShopItemRepository;
import com.luckystar.wallet.postgres.entity.Wallet;
import com.luckystar.wallet.postgres.repository.WalletRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * ADR-001 雙資料源交易語意：postgresTransactionManager 與 mysqlTransactionManager
 * 各管各的，一端 rollback 不會（也不能）帶動另一端。
 *
 * <p>這是 wallet-service 最容易被單資料源直覺誤解的地方（AGENTS.md 雷區 5/20）：
 * 在 PG 交易內寫 MySQL，MySQL 端由自己的 TransactionManager 各自提交，
 * PG 事後 rollback 救不回 MySQL 已提交的資料——跨庫沒有分散式交易，
 * 一致性靠冪等鍵＋事件同步補。H2 測試兩端其實是兩個 H2 庫，
 * 語意近似但從未在真 PG + 真 MySQL 上驗證過，本測試補上。
 */
class DualDatasourceTxSemanticsContainerTest extends AbstractDualDatasourceContainerTest {

    private static final Long PLAYER = 930001L;
    private static final String ITEM_CODE = "containers-tx-item";

    @Autowired WalletRepository walletRepository;   // PostgreSQL
    @Autowired ShopItemRepository shopItemRepository; // MySQL

    TransactionTemplate postgresTx;
    TransactionTemplate mysqlTx;

    @Autowired
    void initTransactionTemplates(
            @Qualifier("postgresTransactionManager") PlatformTransactionManager postgresTm,
            @Qualifier("mysqlTransactionManager") PlatformTransactionManager mysqlTm) {
        this.postgresTx = new TransactionTemplate(postgresTm);
        this.mysqlTx = new TransactionTemplate(mysqlTm);
    }

    @BeforeEach
    @AfterEach
    void cleanUp() {
        walletRepository.findById(PLAYER).ifPresent(walletRepository::delete);
        shopItemRepository.findAll().stream()
                .filter(i -> ITEM_CODE.equals(i.getItemCode()))
                .forEach(shopItemRepository::delete);
    }

    @Test
    void postgresRollback_doesNotRollBackMysqlWrite() {
        postgresTx.execute(status -> {
            walletRepository.save(newWallet());
            // MySQL repo 綁 mysqlTransactionManager：這筆在自己的交易內立刻提交
            shopItemRepository.save(newShopItem());
            status.setRollbackOnly();
            return null;
        });

        // PG 端回滾了；MySQL 端已提交、不受影響
        assertThat(walletRepository.findById(PLAYER)).isEmpty();
        assertThat(shopItemRepository.findAll())
                .anyMatch(i -> ITEM_CODE.equals(i.getItemCode()));
    }

    @Test
    void mysqlRollback_doesNotRollBackPostgresWrite() {
        mysqlTx.execute(status -> {
            shopItemRepository.save(newShopItem());
            // PG repo 綁 postgresTransactionManager：同理，各自提交
            walletRepository.save(newWallet());
            status.setRollbackOnly();
            return null;
        });

        assertThat(shopItemRepository.findAll())
                .noneMatch(i -> ITEM_CODE.equals(i.getItemCode()));
        assertThat(walletRepository.findById(PLAYER)).isPresent();
    }

    @Test
    void postgresRollback_rollsBackItsOwnWrite() {
        // 對照組：PG 自己交易內的寫入，rollback 後必須消失（驗證 TM 真的有接上）
        postgresTx.execute(status -> {
            walletRepository.save(newWallet());
            status.setRollbackOnly();
            return null;
        });
        assertThat(walletRepository.findById(PLAYER)).isEmpty();
    }

    private Wallet newWallet() {
        return Wallet.builder()
                .playerId(PLAYER).balance(500L).frozenAmount(0L).version(0L)
                .build();
    }

    private ShopItem newShopItem() {
        return ShopItem.builder()
                .itemCode(ITEM_CODE).name("容器測試商品").caption("tx semantics")
                .costStar(100L).assetKey("shopPrizeA").sortOrder(99).active(false)
                .build();
    }
}
