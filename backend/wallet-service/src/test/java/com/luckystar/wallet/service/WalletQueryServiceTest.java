package com.luckystar.wallet.service;

import com.luckystar.wallet.common.PagedResponse;
import com.luckystar.wallet.dto.WalletTransactionResponse;
import com.luckystar.wallet.mysql.entity.WalletTransactionView;
import com.luckystar.wallet.mysql.repository.WalletTransactionViewRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WalletQueryServiceTest {

    @Mock
    WalletTransactionViewRepository repository;

    @InjectMocks
    WalletQueryService walletQueryService;

    private WalletTransactionView view(long id, String type, long amount) {
        return WalletTransactionView.builder()
                .id(id)
                .playerId(42L)
                .type(type)
                .subType("BET")
                .amount(amount)
                .balanceBefore(1000L)
                .balanceAfter(1000L - amount)
                .referenceId("round-" + id)
                .createdAt(LocalDateTime.of(2026, 5, 1, 10, 0))
                .build();
    }

    @Test
    void getTransactions_mapsPageAndMetadata() {
        var content = List.of(view(2L, "DEBIT", 100L), view(1L, "CREDIT", 50L));
        Pageable pageable = PageRequest.of(0, 20);
        when(repository.search(eq(42L), eq("DEBIT"), any(), any(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(content, pageable, 2));

        PagedResponse<WalletTransactionResponse> result = walletQueryService.getTransactions(
                42L, "DEBIT", null, null, 0, 20);

        assertThat(result.content()).hasSize(2);
        assertThat(result.page()).isZero();
        assertThat(result.size()).isEqualTo(20);
        assertThat(result.totalElements()).isEqualTo(2);
        assertThat(result.totalPages()).isEqualTo(1);

        WalletTransactionResponse first = result.content().get(0);
        assertThat(first.id()).isEqualTo(2L);
        assertThat(first.type()).isEqualTo("DEBIT");
        assertThat(first.amount()).isEqualTo(100L);
        assertThat(first.referenceId()).isEqualTo("round-2");
    }

    @Test
    void getTransactions_buildsPageableSortedByCreatedAtThenIdDesc() {
        when(repository.search(any(), any(), any(), any(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of()));

        walletQueryService.getTransactions(42L, null, null, null, 3, 15);

        ArgumentCaptor<Pageable> captor = ArgumentCaptor.forClass(Pageable.class);
        verify(repository).search(eq(42L), eq(null), eq(null), eq(null), captor.capture());

        Pageable pageable = captor.getValue();
        assertThat(pageable.getPageNumber()).isEqualTo(3);
        assertThat(pageable.getPageSize()).isEqualTo(15);
        assertThat(pageable.getSort().getOrderFor("createdAt"))
                .isNotNull()
                .extracting(Sort.Order::getDirection)
                .isEqualTo(Sort.Direction.DESC);
        assertThat(pageable.getSort().getOrderFor("id"))
                .isNotNull()
                .extracting(Sort.Order::getDirection)
                .isEqualTo(Sort.Direction.DESC);
    }

    @Test
    void getTransactions_passesDateRangeThrough() {
        LocalDateTime from = LocalDateTime.of(2026, 5, 1, 0, 0);
        LocalDateTime to = LocalDateTime.of(2026, 5, 8, 0, 0);
        when(repository.search(any(), any(), any(), any(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of()));

        walletQueryService.getTransactions(42L, "BONUS", from, to, 0, 20);

        verify(repository).search(eq(42L), eq("BONUS"), eq(from), eq(to), any(Pageable.class));
    }
}
