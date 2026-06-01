package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.BankruptcyAidResponse;
import com.luckystar.wallet.dto.CreditRequest;
import com.luckystar.wallet.dto.CreditResponse;
import com.luckystar.wallet.dto.WalletBalanceResponse;
import com.luckystar.wallet.exception.BankruptcyAidNotEligibleException;
import com.luckystar.wallet.exception.WalletNotFoundException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.orm.ObjectOptimisticLockingFailureException;

import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link BankruptcyAidService} 單元測試（T-027）。
 *
 * <p>Mockito mock 掉 {@link WalletService}（餘額查詢 + 入帳）與 Redis，聚焦協調邏輯：
 * 資格門檻、Redis 當日 SETNX 鎖、入帳失敗釋放鎖、冪等命中保護。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class BankruptcyAidServiceTest {

    @Mock WalletService walletService;
    @Mock StringRedisTemplate redisTemplate;
    @Mock ValueOperations<String, String> valueOps;

    private BankruptcyAidService service() {
        return new BankruptcyAidService(walletService, redisTemplate);
    }

    private CreditResponse credit(boolean idempotent) {
        return CreditResponse.builder()
                .transactionId(99L).playerId(1L).amount(1_000L)
                .balanceBefore(50L).balanceAfter(1_050L)
                .frozenAfter(0L).idempotent(idempotent)
                .build();
    }

    /** SETNX（含 TTL）成功搶到當日鎖的 Redis 樁。 */
    private void stubAcquireOk() {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.setIfAbsent(anyString(), eq("1"), any(Duration.class))).thenReturn(true);
    }

    private static String key() {
        String date = LocalDate.now(ZoneId.of("Asia/Taipei")).toString();
        return "wallet:bankruptcy-aid:1:" + date;
    }

    @Test
    void claim_eligible_acquiresLockCreditsAndReturns() {
        BankruptcyAidService service = service();
        when(walletService.getBalance(1L)).thenReturn(new WalletBalanceResponse(50L, 0L, 50L));
        stubAcquireOk();
        when(walletService.credit(any(CreditRequest.class))).thenReturn(credit(false));

        BankruptcyAidResponse resp = service.claim(1L);

        // 入帳請求帶正確的金額 / subType / 冪等鍵
        ArgumentCaptor<CreditRequest> captor = ArgumentCaptor.forClass(CreditRequest.class);
        verify(walletService).credit(captor.capture());
        CreditRequest req = captor.getValue();
        assertThat(req.getPlayerId()).isEqualTo(1L);
        assertThat(req.getAmount()).isEqualTo(1_000L);
        assertThat(req.getSubType()).isEqualTo("BANKRUPTCY_AID");
        assertThat(req.getIdempotencyKey()).isEqualTo("bankruptcy-aid:1:"
                + LocalDate.now(ZoneId.of("Asia/Taipei")));

        // 搶到鎖時 SETNX 帶 TTL 一次完成，且未釋放鎖
        verify(valueOps).setIfAbsent(eq(key()), eq("1"), any(Duration.class));
        verify(redisTemplate, never()).delete(anyString());

        assertThat(resp.getAmount()).isEqualTo(1_000L);
        assertThat(resp.getTransactionId()).isEqualTo(99L);
        assertThat(resp.getBalanceBefore()).isEqualTo(50L);
        assertThat(resp.getBalanceAfter()).isEqualTo(1_050L);
    }

    @Test
    void claim_balanceAtThreshold_notEligible_noRedisNoCredit() {
        BankruptcyAidService service = service();
        // 餘額剛好等於門檻（100）即不符資格（須 < 100）
        when(walletService.getBalance(1L)).thenReturn(new WalletBalanceResponse(100L, 0L, 100L));

        assertThatThrownBy(() -> service.claim(1L))
                .isInstanceOf(BankruptcyAidNotEligibleException.class)
                .hasMessageContaining("threshold");

        verifyNoInteractions(redisTemplate);
        verify(walletService, never()).credit(any());
    }

    @Test
    void claim_alreadyClaimedToday_setnxFails_noCredit() {
        BankruptcyAidService service = service();
        when(walletService.getBalance(1L)).thenReturn(new WalletBalanceResponse(50L, 0L, 50L));
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.setIfAbsent(anyString(), eq("1"), any(Duration.class))).thenReturn(false); // 今天已領過

        assertThatThrownBy(() -> service.claim(1L))
                .isInstanceOf(BankruptcyAidNotEligibleException.class)
                .hasMessageContaining("already claimed");

        verify(walletService, never()).credit(any());
        verify(redisTemplate, never()).delete(anyString());
    }

    @Test
    void claim_creditFails_releasesLockAndPropagates() {
        BankruptcyAidService service = service();
        when(walletService.getBalance(1L)).thenReturn(new WalletBalanceResponse(50L, 0L, 50L));
        stubAcquireOk();
        when(walletService.credit(any(CreditRequest.class)))
                .thenThrow(new ObjectOptimisticLockingFailureException("Wallet", 1L));

        assertThatThrownBy(() -> service.claim(1L))
                .isInstanceOf(ObjectOptimisticLockingFailureException.class);

        // 入帳失敗 → 釋放當日鎖讓玩家可重試
        verify(redisTemplate).delete(key());
    }

    @Test
    void claim_creditIdempotentHit_treatedAsAlreadyClaimed_keepsLock() {
        BankruptcyAidService service = service();
        when(walletService.getBalance(1L)).thenReturn(new WalletBalanceResponse(50L, 0L, 50L));
        stubAcquireOk();
        // Redis 曾被清空，但 DB 已有當日紀錄 → credit 冪等命中
        when(walletService.credit(any(CreditRequest.class))).thenReturn(credit(true));

        assertThatThrownBy(() -> service.claim(1L))
                .isInstanceOf(BankruptcyAidNotEligibleException.class)
                .hasMessageContaining("already claimed");

        // 不重複加錢、且不釋放鎖（鎖已重新建立）
        verify(redisTemplate, never()).delete(anyString());
    }

    @Test
    void claim_walletNotFound_propagates() {
        BankruptcyAidService service = service();
        when(walletService.getBalance(1L))
                .thenThrow(new WalletNotFoundException("Wallet not found for player: 1"));

        assertThatThrownBy(() -> service.claim(1L))
                .isInstanceOf(WalletNotFoundException.class);

        verifyNoInteractions(redisTemplate);
        verify(walletService, never()).credit(any());
    }
}
