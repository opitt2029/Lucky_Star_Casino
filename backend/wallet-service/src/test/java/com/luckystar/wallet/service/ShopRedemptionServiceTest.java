package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.DebitRequest;
import com.luckystar.wallet.dto.DebitResponse;
import com.luckystar.wallet.dto.ShopRedeemResponse;
import com.luckystar.wallet.exception.InsufficientBalanceException;
import com.luckystar.wallet.exception.ShopItemNotFoundException;
import com.luckystar.wallet.exception.ShopItemUnavailableException;
import com.luckystar.wallet.mysql.entity.ShopItem;
import com.luckystar.wallet.postgres.entity.ShopRedemption;
import com.luckystar.wallet.postgres.repository.ShopRedemptionRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 商城兌換服務單元測試（Mockito，比照 {@link DiamondExchangeServiceTest}）。
 */
@ExtendWith(MockitoExtension.class)
class ShopRedemptionServiceTest {

    @Mock ShopCatalogService shopCatalogService;
    @Mock WalletService walletService;
    @Mock ShopRedemptionRepository shopRedemptionRepository;

    @InjectMocks ShopRedemptionService shopRedemptionService;

    private ShopItem item() {
        return ShopItem.builder()
                .id(1L)
                .itemCode("vip-ticket")
                .name("VIP 入場券")
                .costStar(12000L)
                .active(true)
                .sortOrder(1)
                .build();
    }

    @Test
    void redeem_success_debitsStarAndRecordsRedemption() {
        when(shopCatalogService.findActiveOrThrow("vip-ticket")).thenReturn(item());
        DebitResponse debit = DebitResponse.builder()
                .transactionId(9L).playerId(42L).amount(12000L)
                .balanceBefore(50000L).balanceAfter(38000L).idempotent(false).build();
        when(walletService.debit(any())).thenReturn(debit);
        when(shopRedemptionRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ShopRedeemResponse resp = shopRedemptionService.redeem(42L, "vip-ticket", "ck-1");

        assertThat(resp.getItemCode()).isEqualTo("vip-ticket");
        assertThat(resp.getItemName()).isEqualTo("VIP 入場券");
        assertThat(resp.getStarSpent()).isEqualTo(12000L);
        assertThat(resp.getBalanceAfter()).isEqualTo(38000L);
        assertThat(resp.isIdempotent()).isFalse();

        // 扣款帶 SHOP_PURCHASE 子型、金額為定價、referenceId 為 itemCode
        ArgumentCaptor<DebitRequest> captor = ArgumentCaptor.forClass(DebitRequest.class);
        verify(walletService).debit(captor.capture());
        assertThat(captor.getValue().getAmount()).isEqualTo(12000L);
        assertThat(captor.getValue().getSubType()).isEqualTo("SHOP_PURCHASE");
        assertThat(captor.getValue().getReferenceId()).isEqualTo("vip-ticket");
        assertThat(captor.getValue().getIdempotencyKey()).isEqualTo("shop-redeem:42:ck-1");

        // 寫了一筆兌換紀錄
        ArgumentCaptor<ShopRedemption> recCaptor = ArgumentCaptor.forClass(ShopRedemption.class);
        verify(shopRedemptionRepository).save(recCaptor.capture());
        assertThat(recCaptor.getValue().getStarSpent()).isEqualTo(12000L);
        assertThat(recCaptor.getValue().getBalanceAfter()).isEqualTo(38000L);
    }

    @Test
    void redeem_unknownItem_throwsAndDoesNotDebit() {
        when(shopCatalogService.findActiveOrThrow("nope"))
                .thenThrow(new ShopItemNotFoundException("Shop item not found: nope"));

        assertThatThrownBy(() -> shopRedemptionService.redeem(42L, "nope", null))
                .isInstanceOf(ShopItemNotFoundException.class);

        verify(walletService, never()).debit(any());
        verify(shopRedemptionRepository, never()).save(any());
    }

    @Test
    void redeem_unavailableItem_throwsAndDoesNotDebit() {
        when(shopCatalogService.findActiveOrThrow("off"))
                .thenThrow(new ShopItemUnavailableException("Shop item is not available: off"));

        assertThatThrownBy(() -> shopRedemptionService.redeem(42L, "off", null))
                .isInstanceOf(ShopItemUnavailableException.class);

        verify(walletService, never()).debit(any());
    }

    @Test
    void redeem_insufficientBalance_throwsAndDoesNotRecord() {
        when(shopCatalogService.findActiveOrThrow("vip-ticket")).thenReturn(item());
        when(walletService.debit(any()))
                .thenThrow(new InsufficientBalanceException("Insufficient balance"));

        assertThatThrownBy(() -> shopRedemptionService.redeem(42L, "vip-ticket", "ck-2"))
                .isInstanceOf(InsufficientBalanceException.class);

        verify(shopRedemptionRepository, never()).save(any());
    }

    @Test
    void redeem_idempotentReplay_returnsExistingWithoutSaving() {
        when(shopCatalogService.findActiveOrThrow("vip-ticket")).thenReturn(item());
        DebitResponse debit = DebitResponse.builder()
                .transactionId(9L).playerId(42L).amount(12000L)
                .balanceBefore(50000L).balanceAfter(38000L).idempotent(true).build();
        when(walletService.debit(any())).thenReturn(debit);
        ShopRedemption existing = ShopRedemption.builder()
                .id(7L).playerId(42L).itemCode("vip-ticket").itemName("VIP 入場券")
                .starSpent(12000L).balanceBefore(50000L).balanceAfter(38000L)
                .idempotencyKey("shop-redeem:42:ck-dup").status("COMPLETED").build();
        when(shopRedemptionRepository.findByIdempotencyKey("shop-redeem:42:ck-dup"))
                .thenReturn(Optional.of(existing));

        ShopRedeemResponse resp = shopRedemptionService.redeem(42L, "vip-ticket", "ck-dup");

        assertThat(resp.isIdempotent()).isTrue();
        assertThat(resp.getBalanceAfter()).isEqualTo(38000L);
        verify(shopRedemptionRepository, never()).save(any());
    }
}
