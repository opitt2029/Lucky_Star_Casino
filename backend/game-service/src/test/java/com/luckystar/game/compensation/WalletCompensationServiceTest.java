package com.luckystar.game.compensation;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.luckystar.game.exception.WalletUnavailableException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

/**
 * {@link WalletCompensationService} 單元測試（純 Mockito）。
 * 聚焦 ADR-009 的兩個關鍵保證：credit 失敗 → 落補償單（冪等鍵原封不動）；
 * recordPending 自身絕不拋出例外（它在 catch 區塊內執行，拋出會遮蔽原始錯誤）。
 */
class WalletCompensationServiceTest {

    private static final long PLAYER_ID = 42L;
    private static final String ROUND_ID = "round-1";
    private static final String IDEM_KEY = "slot-win-round-1";

    private final PendingWalletCreditRepository repository =
            mock(PendingWalletCreditRepository.class);
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);

    private WalletCompensationService service;

    @BeforeEach
    void setUp() {
        // mock 交易管理器：getTransaction 回可提交的狀態，讓 TransactionTemplate 正常跑 callback
        when(txManager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(repository.existsByIdempotencyKey(IDEM_KEY)).thenReturn(false);
        service = new WalletCompensationService(repository, txManager);
    }

    @Test
    @DisplayName("credit 失敗 → 寫入 PENDING 補償單，欄位齊全且冪等鍵原封不動")
    void recordPending_persistsPendingRowWithSameIdempotencyKey() {
        WalletUnavailableException cause = new WalletUnavailableException("wallet down");

        service.recordPending("SLOT", ROUND_ID, PLAYER_ID, 500L, "WIN", IDEM_KEY, cause);

        ArgumentCaptor<PendingWalletCredit> captor = ArgumentCaptor.forClass(PendingWalletCredit.class);
        verify(repository).save(captor.capture());
        PendingWalletCredit saved = captor.getValue();
        assertEquals("SLOT", saved.getGameType());
        assertEquals(ROUND_ID, saved.getRoundId());
        assertEquals(PLAYER_ID, saved.getPlayerId());
        assertEquals(500L, saved.getAmount());
        assertEquals("WIN", saved.getSubType());
        assertEquals(IDEM_KEY, saved.getIdempotencyKey(), "冪等鍵必須與失敗的 credit 完全相同");
        assertEquals("PENDING", saved.getStatus());
        assertEquals(0, saved.getRetryCount());
        assertNotNull(saved.getNextRetryAt(), "應立即可被重試排程撈到");
        assertTrue(saved.getLastError().contains("wallet down"), "last_error 應含失敗原因");
    }

    @Test
    @DisplayName("同一冪等鍵已有補償單（重試再失敗）→ 不重複建單")
    void recordPending_duplicateKey_skipsInsert() {
        when(repository.existsByIdempotencyKey(IDEM_KEY)).thenReturn(true);

        service.recordPending("SLOT", ROUND_ID, PLAYER_ID, 500L, "WIN", IDEM_KEY,
                new WalletUnavailableException("wallet down"));

        verify(repository, never()).save(any());
    }

    @Test
    @DisplayName("補償單本身寫入失敗（DB 也故障）→ 只 log 不拋出，不遮蔽呼叫端的原始例外")
    void recordPending_saveFails_neverThrows() {
        when(repository.save(any())).thenThrow(new RuntimeException("db down"));

        assertDoesNotThrow(() -> service.recordPending("SLOT", ROUND_ID, PLAYER_ID, 500L,
                "WIN", IDEM_KEY, new WalletUnavailableException("wallet down")));
    }

    @Test
    @DisplayName("truncateError：超長訊息截斷至欄位上限、null 安全")
    void truncateError_truncatesAndHandlesNull() {
        assertNull(WalletCompensationService.truncateError(null));
        String longMsg = "x".repeat(1000);
        String truncated = WalletCompensationService.truncateError(new RuntimeException(longMsg));
        assertEquals(WalletCompensationService.MAX_ERROR_LENGTH, truncated.length());
    }
}
