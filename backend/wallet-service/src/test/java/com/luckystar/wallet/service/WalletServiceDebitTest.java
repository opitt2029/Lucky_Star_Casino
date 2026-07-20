package com.luckystar.wallet.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.dto.DebitRequest;
import com.luckystar.wallet.dto.DebitResponse;
import com.luckystar.wallet.exception.InsufficientBalanceException;
import com.luckystar.wallet.exception.WalletNotFoundException;
import com.luckystar.wallet.postgres.entity.Wallet;
import com.luckystar.wallet.postgres.entity.WalletTransaction;
import com.luckystar.wallet.postgres.repository.WalletDebitDao;
import com.luckystar.wallet.postgres.repository.WalletRepository;
import com.luckystar.wallet.postgres.repository.WalletTransactionRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.core.KafkaTemplate;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * T-090 B2 改版後的 debit 單元測試：熱路徑改為 WalletDebitDao 兩往返
 * （條件 UPDATE → INSERT ON CONFLICT），此處以 mock DAO 驗證 WalletService 的流程分支；
 * 真 SQL 的原子語意由 containers/WalletDebitRoundTripContainerTest（真 PG）守門。
 */
@ExtendWith(MockitoExtension.class)
class WalletServiceDebitTest {

    @Mock
    WalletRepository walletRepository;

    @Mock
    WalletTransactionRepository walletTransactionRepository;

    @Mock
    WalletDebitDao walletDebitDao;

    @Mock
    KafkaTemplate<String, String> kafkaTemplate;

    @Mock
    ObjectMapper objectMapper;

    @InjectMocks
    WalletService walletService;

    private WalletTransaction buildTransaction(Long id, Long playerId, Long amount,
                                               Long balanceBefore, Long balanceAfter,
                                               String idempotencyKey) {
        return WalletTransaction.builder()
                .id(id)
                .playerId(playerId)
                .type("DEBIT")
                .subType("BET")
                .amount(amount)
                .balanceBefore(balanceBefore)
                .balanceAfter(balanceAfter)
                .idempotencyKey(idempotencyKey)
                .build();
    }

    private DebitRequest buildRequest(Long playerId, Long amount, String idempotencyKey) {
        DebitRequest req = new DebitRequest();
        req.setPlayerId(playerId);
        req.setAmount(amount);
        req.setIdempotencyKey(idempotencyKey);
        return req;
    }

    @Test
    void debit_newIdempotencyKey_sufficientBalance_insertsLedgerAndPublishesKafka() throws Exception {
        DebitRequest request = buildRequest(1L, 300L, "key-001");

        // 往返 1 成功：扣款後餘額 700
        when(walletDebitDao.deductIfSufficientAndKeyUnused(1L, 300L, "key-001"))
                .thenReturn(Optional.of(700L));
        // 往返 2 成功：流水 id = 1
        when(walletDebitDao.insertDebitTransaction(1L, "BET", 300L, 1000L, 700L, "key-001", null))
                .thenReturn(Optional.of(1L));
        when(objectMapper.writeValueAsString(any())).thenReturn("{}");

        DebitResponse response = walletService.debit(request);

        verify(kafkaTemplate, times(1)).send(eq("wallet.debit"), eq("1"), anyString());
        assertThat(response.getTransactionId()).isEqualTo(1L);
        assertThat(response.getBalanceBefore()).isEqualTo(1000L);
        assertThat(response.getBalanceAfter()).isEqualTo(700L);
        assertThat(response.isIdempotent()).isFalse();

        // 熱路徑不碰 JPA repository（4→2 往返的核心目標）
        verify(walletRepository, never()).findById(any());
        verify(walletTransactionRepository, never()).findByIdempotencyKey(any());
    }

    @Test
    void debit_nullSubType_defaultsToBet() {
        DebitRequest request = buildRequest(1L, 300L, "key-sub");
        request.setSubType(null);
        when(walletDebitDao.deductIfSufficientAndKeyUnused(1L, 300L, "key-sub"))
                .thenReturn(Optional.of(700L));
        when(walletDebitDao.insertDebitTransaction(anyLong(), anyString(), anyLong(),
                anyLong(), anyLong(), anyString(), any()))
                .thenReturn(Optional.of(5L));

        walletService.debit(request);

        // subType 未帶 → 預設 BET（既有行為，AGENTS.md 雷區 18）
        verify(walletDebitDao).insertDebitTransaction(1L, "BET", 300L, 1000L, 700L, "key-sub", null);
    }

    @Test
    void debit_duplicateIdempotencyKey_returnsExistingTransactionWithoutWrites() {
        // 冪等重放：往返 1 的 NOT EXISTS 預檢擋下（0 列、零副作用）→ 冷路徑回原交易
        DebitRequest request = buildRequest(1L, 300L, "key-dup");
        WalletTransaction existingTx = buildTransaction(99L, 1L, 300L, 1000L, 700L, "key-dup");

        when(walletDebitDao.deductIfSufficientAndKeyUnused(1L, 300L, "key-dup"))
                .thenReturn(Optional.empty());
        when(walletTransactionRepository.findByIdempotencyKey("key-dup"))
                .thenReturn(Optional.of(existingTx));

        DebitResponse response = walletService.debit(request);

        verify(walletDebitDao, never()).insertDebitTransaction(anyLong(), anyString(), anyLong(),
                anyLong(), anyLong(), anyString(), any());
        verify(walletDebitDao, never()).restoreBalance(anyLong(), anyLong());
        verify(kafkaTemplate, never()).send(anyString(), anyString(), anyString());

        assertThat(response.getTransactionId()).isEqualTo(99L);
        assertThat(response.getBalanceBefore()).isEqualTo(1000L);
        assertThat(response.getBalanceAfter()).isEqualTo(700L);
        assertThat(response.isIdempotent()).isTrue();
    }

    @Test
    void debit_insufficientBalance_throwsInsufficientBalanceException() {
        // 往返 1 守衛未過（0 列）、冪等鍵沒用過、錢包存在 → 餘額不足
        DebitRequest request = buildRequest(1L, 500L, "key-002");

        when(walletDebitDao.deductIfSufficientAndKeyUnused(1L, 500L, "key-002"))
                .thenReturn(Optional.empty());
        when(walletTransactionRepository.findByIdempotencyKey("key-002")).thenReturn(Optional.empty());
        when(walletRepository.findById(1L)).thenReturn(Optional.of(new Wallet()));

        assertThatThrownBy(() -> walletService.debit(request))
                .isInstanceOf(InsufficientBalanceException.class)
                .hasMessage("Insufficient balance");

        verify(walletDebitDao, never()).insertDebitTransaction(anyLong(), anyString(), anyLong(),
                anyLong(), anyLong(), anyString(), any());
    }

    @Test
    void debit_walletNotFound_throwsWalletNotFoundException() {
        DebitRequest request = buildRequest(99L, 100L, "key-003");

        when(walletDebitDao.deductIfSufficientAndKeyUnused(99L, 100L, "key-003"))
                .thenReturn(Optional.empty());
        when(walletTransactionRepository.findByIdempotencyKey("key-003")).thenReturn(Optional.empty());
        when(walletRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> walletService.debit(request))
                .isInstanceOf(WalletNotFoundException.class)
                .hasMessageContaining("99");

        verify(kafkaTemplate, never()).send(anyString(), anyString(), anyString());
    }

    @Test
    void debit_concurrentSameIdempotencyKey_compensatesAndReturnsWinnerRecord() {
        // 極窄競態：兩請求同時通過往返 1 預檢 → 往返 2 撞冪等鍵（empty）
        // → 原地補償回沖 + 回查贏家紀錄，回 idempotent=true
        DebitRequest request = buildRequest(1L, 300L, "key-race");
        WalletTransaction winnerTx = buildTransaction(77L, 1L, 300L, 1000L, 700L, "key-race");

        when(walletDebitDao.deductIfSufficientAndKeyUnused(1L, 300L, "key-race"))
                .thenReturn(Optional.of(400L)); // 本方也扣到了（雙扣狀態）
        when(walletDebitDao.insertDebitTransaction(1L, "BET", 300L, 700L, 400L, "key-race", null))
                .thenReturn(Optional.empty());  // 流水被贏家先寫走
        when(walletTransactionRepository.findByIdempotencyKey("key-race"))
                .thenReturn(Optional.of(winnerTx));

        DebitResponse response = walletService.debit(request);

        // 必須把自己多扣的 300 加回去（淨額歸零）
        verify(walletDebitDao, times(1)).restoreBalance(1L, 300L);
        assertThat(response.getTransactionId()).isEqualTo(77L);
        assertThat(response.isIdempotent()).isTrue();
        verify(kafkaTemplate, never()).send(anyString(), anyString(), anyString());
    }

    // ---------------------------------------------------------------
    // T-024 冪等性防重複機制：補強邊界案例
    // ---------------------------------------------------------------

    @Test
    void debit_duplicateIdempotencyKey_returnsStoredValuesNotRequestValues() {
        // 同一冪等鍵重送時，即使請求金額被竄改，也必須回傳「原始交易」的數值
        DebitRequest request = buildRequest(1L, 999L, "key-stored");
        WalletTransaction existingTx = buildTransaction(42L, 1L, 300L, 1000L, 700L, "key-stored");

        when(walletDebitDao.deductIfSufficientAndKeyUnused(1L, 999L, "key-stored"))
                .thenReturn(Optional.empty());
        when(walletTransactionRepository.findByIdempotencyKey("key-stored"))
                .thenReturn(Optional.of(existingTx));

        DebitResponse response = walletService.debit(request);

        // 回傳以原始交易為準，而非請求的 999
        assertThat(response.getAmount()).isEqualTo(300L);
        assertThat(response.getTransactionId()).isEqualTo(42L);
        assertThat(response.getBalanceBefore()).isEqualTo(1000L);
        assertThat(response.getBalanceAfter()).isEqualTo(700L);
        assertThat(response.isIdempotent()).isTrue();

        // 冪等命中只查一次流水，且完全不碰錢包
        verify(walletTransactionRepository, times(1)).findByIdempotencyKey("key-stored");
        verify(walletRepository, never()).findById(any());
    }

    @Test
    void debit_conflictButWinnerMissing_throwsIllegalState() {
        // 往返 2 判定衝突、補償後回查卻查不到贏家（理論上不該發生）→ 拋 IllegalStateException，
        // 而非吞掉錯誤回傳假成功；補償仍須執行（錢已在往返 1 扣走）
        DebitRequest request = buildRequest(1L, 300L, "key-ghost");

        when(walletDebitDao.deductIfSufficientAndKeyUnused(1L, 300L, "key-ghost"))
                .thenReturn(Optional.of(700L));
        when(walletDebitDao.insertDebitTransaction(1L, "BET", 300L, 1000L, 700L, "key-ghost", null))
                .thenReturn(Optional.empty());
        when(walletTransactionRepository.findByIdempotencyKey("key-ghost"))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> walletService.debit(request))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("key-ghost");

        verify(walletDebitDao, times(1)).restoreBalance(1L, 300L);
        verify(kafkaTemplate, never()).send(anyString(), anyString(), anyString());
    }
}
