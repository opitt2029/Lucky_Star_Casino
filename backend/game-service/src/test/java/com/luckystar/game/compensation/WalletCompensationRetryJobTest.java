package com.luckystar.game.compensation;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.luckystar.game.client.WalletClient;
import com.luckystar.game.client.dto.WalletCreditResponse;
import com.luckystar.game.exception.WalletUnavailableException;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@link WalletCompensationRetryJob} 單元測試（純 Mockito）。
 * 驗證 ADR-009 的補償重試語意：帶「與原始呼叫相同的冪等鍵」重呼 credit、
 * 成功標 DONE、失敗指數退避、超限標 FAILED。
 */
class WalletCompensationRetryJobTest {

    private static final long PLAYER_ID = 42L;

    private final PendingWalletCreditRepository repository =
            mock(PendingWalletCreditRepository.class);
    private final WalletClient walletClient = mock(WalletClient.class);

    private final WalletCompensationRetryJob job =
            new WalletCompensationRetryJob(repository, walletClient);

    private static PendingWalletCredit pending(String idemKey, int retryCount) {
        PendingWalletCredit p = new PendingWalletCredit();
        p.setId(1L);
        p.setGameType("SLOT");
        p.setRoundId("round-1");
        p.setPlayerId(PLAYER_ID);
        p.setAmount(500L);
        p.setSubType("WIN");
        p.setIdempotencyKey(idemKey);
        p.setStatus("PENDING");
        p.setRetryCount(retryCount);
        p.setNextRetryAt(LocalDateTime.now().minusSeconds(1));
        return p;
    }

    @Test
    @DisplayName("重試成功 → credit 帶原封不動的冪等鍵/子型/referenceId，補償單標 DONE")
    void retry_success_marksDoneWithSameIdempotencyKey() {
        PendingWalletCredit p = pending("slot-win-round-1", 0);
        when(repository.findTop50ByStatusAndNextRetryAtLessThanEqualOrderByIdAsc(eq("PENDING"), any()))
                .thenReturn(List.of(p));
        when(walletClient.credit(anyLong(), anyLong(), anyString(), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, 500L, 9900L, 10400L, 0L, false));

        job.retryPending();

        // 冪等鍵不變（安全根基）：wallet 端同 key 只會入帳一次
        verify(walletClient).credit(eq(PLAYER_ID), eq(500L), eq("WIN"),
                eq("slot-win-round-1"), eq("round-1"));
        verify(repository).save(p);
        assertEquals("DONE", p.getStatus());
        assertNotNull(p.getDoneAt());
    }

    @Test
    @DisplayName("重試失敗 → retry_count+1、指數退避、仍為 PENDING")
    void retry_failure_backsOffExponentially() {
        PendingWalletCredit p = pending("slot-win-round-1", 0);
        when(repository.findTop50ByStatusAndNextRetryAtLessThanEqualOrderByIdAsc(eq("PENDING"), any()))
                .thenReturn(List.of(p));
        when(walletClient.credit(anyLong(), anyLong(), anyString(), anyString(), anyString()))
                .thenThrow(new WalletUnavailableException("wallet still down"));

        LocalDateTime before = LocalDateTime.now();
        job.retryPending();

        assertEquals("PENDING", p.getStatus());
        assertEquals(1, p.getRetryCount());
        assertTrue(p.getLastError().contains("wallet still down"));
        assertTrue(p.getNextRetryAt().isAfter(before.plusSeconds(29)),
                "第 1 次失敗後應退避至少 30 秒，實際=" + p.getNextRetryAt());
        verify(repository).save(p);
    }

    @Test
    @DisplayName("重試達上限 → 標 FAILED（需人工對帳），不再排下次重試")
    void retry_exceedsMaxRetries_marksFailed() {
        PendingWalletCredit p = pending("slot-win-round-1", WalletCompensationRetryJob.MAX_RETRIES - 1);
        when(repository.findTop50ByStatusAndNextRetryAtLessThanEqualOrderByIdAsc(eq("PENDING"), any()))
                .thenReturn(List.of(p));
        when(walletClient.credit(anyLong(), anyLong(), anyString(), anyString(), anyString()))
                .thenThrow(new WalletUnavailableException("wallet still down"));

        job.retryPending();

        assertEquals("FAILED", p.getStatus());
        assertEquals(WalletCompensationRetryJob.MAX_RETRIES, p.getRetryCount());
        verify(repository).save(p);
    }

    @Test
    @DisplayName("單筆失敗不中斷整批：第一筆失敗後第二筆仍被處理")
    void retry_oneFailureDoesNotAbortBatch() {
        PendingWalletCredit bad = pending("slot-win-round-1", 0);
        PendingWalletCredit good = pending("bac-win-round-2", 0);
        good.setId(2L);
        good.setGameType("BACCARAT");
        good.setRoundId("round-2");
        when(repository.findTop50ByStatusAndNextRetryAtLessThanEqualOrderByIdAsc(eq("PENDING"), any()))
                .thenReturn(List.of(bad, good));
        when(walletClient.credit(anyLong(), anyLong(), anyString(), eq("slot-win-round-1"), anyString()))
                .thenThrow(new WalletUnavailableException("boom"));
        when(walletClient.credit(anyLong(), anyLong(), anyString(), eq("bac-win-round-2"), anyString()))
                .thenReturn(new WalletCreditResponse(3L, PLAYER_ID, 500L, 9900L, 10400L, 0L, false));

        job.retryPending();

        assertEquals("PENDING", bad.getStatus());
        assertEquals("DONE", good.getStatus());
    }

    @Test
    @DisplayName("撈單本身失敗（DB 抖動）→ 略過本輪、不拋出")
    void retry_repositoryDown_skipsRoundQuietly() {
        when(repository.findTop50ByStatusAndNextRetryAtLessThanEqualOrderByIdAsc(eq("PENDING"), any()))
                .thenThrow(new RuntimeException("db down"));

        assertDoesNotThrow(job::retryPending);
    }

    @Test
    @DisplayName("backoffSeconds：30s 起倍增、上限 1800s")
    void backoffSeconds_doublesWithCap() {
        assertEquals(30L, WalletCompensationRetryJob.backoffSeconds(1));
        assertEquals(60L, WalletCompensationRetryJob.backoffSeconds(2));
        assertEquals(120L, WalletCompensationRetryJob.backoffSeconds(3));
        assertEquals(960L, WalletCompensationRetryJob.backoffSeconds(6));
        assertEquals(1800L, WalletCompensationRetryJob.backoffSeconds(7));
        assertEquals(1800L, WalletCompensationRetryJob.backoffSeconds(10));
    }
}
