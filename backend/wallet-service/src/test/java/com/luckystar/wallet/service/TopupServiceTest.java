package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.CreditRequest;
import com.luckystar.wallet.dto.CreditResponse;
import com.luckystar.wallet.dto.TopupOrderResponse;
import com.luckystar.wallet.dto.TopupPackageResponse;
import com.luckystar.wallet.exception.IllegalTopupStateException;
import com.luckystar.wallet.exception.InvalidTopupPackageException;
import com.luckystar.wallet.exception.TopupOrderNotFoundException;
import com.luckystar.wallet.postgres.entity.TopupOrder;
import com.luckystar.wallet.postgres.repository.TopupOrderRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 自助加值單元測試。Mockito mock 掉 repository 與 WalletService，不需資料庫。
 */
@ExtendWith(MockitoExtension.class)
class TopupServiceTest {

    @Mock
    TopupOrderRepository topupOrderRepository;

    @Mock
    WalletService walletService;

    @InjectMocks
    TopupService topupService;

    @Test
    void getPackages_returnsThreeFixedPackages() {
        List<TopupPackageResponse> packages = topupService.getPackages();
        assertThat(packages).extracting(TopupPackageResponse::packageId)
                .containsExactly("P100", "P500", "P1000");
        assertThat(packages).extracting(TopupPackageResponse::amount)
                .containsExactly(100_000L, 600_000L, 1_300_000L);
    }

    @Test
    void createOrder_validPackage_savesCreatedOrder() {
        when(topupOrderRepository.save(any(TopupOrder.class))).thenAnswer(inv -> inv.getArgument(0));

        TopupOrderResponse resp = topupService.createOrder(1169L, "P500");

        ArgumentCaptor<TopupOrder> captor = ArgumentCaptor.forClass(TopupOrder.class);
        verify(topupOrderRepository).save(captor.capture());
        TopupOrder saved = captor.getValue();
        assertThat(saved.getPlayerId()).isEqualTo(1169L);
        assertThat(saved.getAmount()).isEqualTo(600_000L);
        assertThat(saved.getPriceLabel()).isEqualTo("NT$500");
        assertThat(saved.getStatus()).isEqualTo("CREATED");
        assertThat(saved.getOrderNo()).isNotBlank();
        assertThat(resp.status()).isEqualTo("CREATED");
    }

    @Test
    void createOrder_unknownPackage_throws() {
        assertThatThrownBy(() -> topupService.createOrder(1169L, "P999"))
                .isInstanceOf(InvalidTopupPackageException.class);
        verify(topupOrderRepository, never()).save(any());
    }

    @Test
    void pay_createdOrder_creditsAndMarksCredited() {
        TopupOrder order = TopupOrder.builder()
                .id(10L).orderNo("TOP-abc").playerId(1169L)
                .packageId("P100").amount(100_000L).priceLabel("NT$100")
                .status("CREATED").build();
        when(topupOrderRepository.findByIdAndPlayerId(10L, 1169L)).thenReturn(Optional.of(order));
        when(topupOrderRepository.save(any(TopupOrder.class))).thenAnswer(inv -> inv.getArgument(0));
        when(walletService.credit(any(CreditRequest.class))).thenReturn(
                CreditResponse.builder().transactionId(555L).playerId(1169L)
                        .amount(100_000L).balanceBefore(200L).balanceAfter(100_200L)
                        .idempotent(false).build());

        TopupOrderResponse resp = topupService.pay(1169L, 10L);

        ArgumentCaptor<CreditRequest> creditCaptor = ArgumentCaptor.forClass(CreditRequest.class);
        verify(walletService).credit(creditCaptor.capture());
        CreditRequest credit = creditCaptor.getValue();
        assertThat(credit.getSubType()).isEqualTo("TOPUP");
        assertThat(credit.getIdempotencyKey()).isEqualTo("topup-TOP-abc");
        assertThat(credit.getAmount()).isEqualTo(100_000L);

        assertThat(resp.status()).isEqualTo("CREDITED");
        assertThat(resp.creditTxId()).isEqualTo(555L);
        assertThat(resp.balanceAfter()).isEqualTo(100_200L);
    }

    @Test
    void pay_nonCreatedOrder_throwsIllegalState() {
        TopupOrder order = TopupOrder.builder()
                .id(10L).orderNo("TOP-abc").playerId(1169L)
                .packageId("P100").amount(100_000L).priceLabel("NT$100")
                .status("CREDITED").build();
        when(topupOrderRepository.findByIdAndPlayerId(10L, 1169L)).thenReturn(Optional.of(order));

        assertThatThrownBy(() -> topupService.pay(1169L, 10L))
                .isInstanceOf(IllegalTopupStateException.class);
        verify(walletService, never()).credit(any());
    }

    @Test
    void pay_missingOrder_throwsNotFound() {
        when(topupOrderRepository.findByIdAndPlayerId(99L, 1169L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> topupService.pay(1169L, 99L))
                .isInstanceOf(TopupOrderNotFoundException.class);
    }
}
