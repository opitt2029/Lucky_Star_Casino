package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.ShopInventoryItem;
import com.luckystar.wallet.dto.ShopRedeemResponse;
import com.luckystar.wallet.exception.InsufficientBalanceException;
import com.luckystar.wallet.exception.ShopItemNotFoundException;
import com.luckystar.wallet.exception.ShopItemUnavailableException;
import com.luckystar.wallet.mysql.entity.ShopItem;
import com.luckystar.wallet.mysql.repository.ShopItemRepository;
import com.luckystar.wallet.postgres.entity.Wallet;
import com.luckystar.wallet.postgres.entity.WalletTransaction;
import com.luckystar.wallet.postgres.repository.ShopRedemptionRepository;
import com.luckystar.wallet.postgres.repository.WalletRepository;
import com.luckystar.wallet.postgres.repository.WalletTransactionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 商城兌換「真實雙資料源」整合測試（@SpringBootTest + H2 雙庫）。
 *
 * <p>與 {@link ShopRedemptionServiceTest}（Mockito）互補：此測試實際執行
 * 「postgres 交易方法 redeem() 內呼叫 mysql 交易方法 findActiveOrThrow()、
 * 再 join postgres 的 debit()、寫 shop_redemptions」的跨資料源接線，確認交易管理器搭配正確、
 * 扣款與兌換紀錄真的落庫且原子。KafkaTemplate 以 @MockBean 取代，避免連不到 broker 阻塞。
 */
@SpringBootTest
class ShopRedemptionIntegrationTest {

    private static final Long PLAYER = 7001L;

    @Autowired ShopRedemptionService shopRedemptionService;
    @Autowired ShopItemRepository shopItemRepository;                 // MySQL
    @Autowired WalletRepository walletRepository;                     // PostgreSQL
    @Autowired WalletTransactionRepository walletTransactionRepository; // PostgreSQL
    @Autowired ShopRedemptionRepository shopRedemptionRepository;     // PostgreSQL

    @MockBean KafkaTemplate<String, String> kafkaTemplate;

    @BeforeEach
    void setUp() {
        shopRedemptionRepository.deleteAll();
        walletTransactionRepository.deleteAll();
        walletRepository.deleteAll();
        shopItemRepository.deleteAll();

        shopItemRepository.save(ShopItem.builder()
                .itemCode("vip-ticket").name("VIP 入場券").caption("說明")
                .costStar(12000L).assetKey("shopPrizeA").sortOrder(1).active(true)
                .build());

        walletRepository.save(Wallet.builder()
                .playerId(PLAYER).balance(50000L).frozenAmount(0L).version(0L)
                .build());
    }

    @Test
    void redeem_success_debitsStarAndWritesRedemptionAtomically() {
        ShopRedeemResponse resp = shopRedemptionService.redeem(PLAYER, "vip-ticket", "k1");

        assertThat(resp.getStarSpent()).isEqualTo(12000L);
        assertThat(resp.getBalanceAfter()).isEqualTo(38000L);
        assertThat(resp.isIdempotent()).isFalse();

        // 星幣真的扣了（postgres wallets）
        assertThat(walletRepository.findById(PLAYER)).get()
                .extracting(Wallet::getBalance).isEqualTo(38000L);

        // 寫了一筆 DEBIT/SHOP_PURCHASE 流水
        List<WalletTransaction> txs = walletTransactionRepository.findAll();
        assertThat(txs).hasSize(1);
        assertThat(txs.get(0).getType()).isEqualTo("DEBIT");
        assertThat(txs.get(0).getSubType()).isEqualTo("SHOP_PURCHASE");
        assertThat(txs.get(0).getAmount()).isEqualTo(12000L);

        // 寫了一筆兌換紀錄、背包可讀
        assertThat(shopRedemptionRepository.findByPlayerIdOrderByCreatedAtDesc(PLAYER)).hasSize(1);
        List<ShopInventoryItem> inv = shopRedemptionService.getInventory(PLAYER);
        assertThat(inv).hasSize(1);
        assertThat(inv.get(0).getItemCode()).isEqualTo("vip-ticket");
        assertThat(inv.get(0).getTitle()).isEqualTo("VIP 入場券");
    }

    @Test
    void redeem_insufficientBalance_throwsAndNothingPersisted() {
        Wallet poor = walletRepository.findById(PLAYER).orElseThrow();
        poor.setBalance(100L);
        walletRepository.save(poor);

        assertThatThrownBy(() -> shopRedemptionService.redeem(PLAYER, "vip-ticket", "k2"))
                .isInstanceOf(InsufficientBalanceException.class);

        // 餘額不變、無扣款流水、無兌換紀錄（原子回滾）
        assertThat(walletRepository.findById(PLAYER)).get()
                .extracting(Wallet::getBalance).isEqualTo(100L);
        assertThat(walletTransactionRepository.findAll()).isEmpty();
        assertThat(shopRedemptionRepository.findByPlayerIdOrderByCreatedAtDesc(PLAYER)).isEmpty();
    }

    @Test
    void redeem_idempotentSameKey_debitsOnce() {
        ShopRedeemResponse first = shopRedemptionService.redeem(PLAYER, "vip-ticket", "dup");
        ShopRedeemResponse second = shopRedemptionService.redeem(PLAYER, "vip-ticket", "dup");

        assertThat(first.isIdempotent()).isFalse();
        assertThat(second.isIdempotent()).isTrue();

        // 只扣一次、只一筆紀錄
        assertThat(walletRepository.findById(PLAYER)).get()
                .extracting(Wallet::getBalance).isEqualTo(38000L);
        assertThat(shopRedemptionRepository.findByPlayerIdOrderByCreatedAtDesc(PLAYER)).hasSize(1);
    }

    @Test
    void redeem_unknownItem_throwsNotFound() {
        assertThatThrownBy(() -> shopRedemptionService.redeem(PLAYER, "nope", "k3"))
                .isInstanceOf(ShopItemNotFoundException.class);
        assertThat(walletRepository.findById(PLAYER)).get()
                .extracting(Wallet::getBalance).isEqualTo(50000L);
    }

    @Test
    void redeem_inactiveItem_throwsUnavailable() {
        ShopItem item = shopItemRepository.findByItemCode("vip-ticket").orElseThrow();
        item.setActive(false);
        shopItemRepository.save(item);

        assertThatThrownBy(() -> shopRedemptionService.redeem(PLAYER, "vip-ticket", "k4"))
                .isInstanceOf(ShopItemUnavailableException.class);
        assertThat(walletRepository.findById(PLAYER)).get()
                .extracting(Wallet::getBalance).isEqualTo(50000L);
    }

    @Test
    void getCatalog_returnsActiveItemsOnly() {
        shopItemRepository.save(ShopItem.builder()
                .itemCode("hidden").name("下架品").costStar(999L).sortOrder(9).active(false)
                .build());

        assertThat(shopRedemptionService.getCatalog())
                .extracting(v -> v.getItemCode())
                .containsExactly("vip-ticket");
    }
}
