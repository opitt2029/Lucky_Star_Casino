package com.luckystar.game.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.client.WalletClient;
import com.luckystar.game.client.dto.WalletCreditResponse;
import com.luckystar.game.client.dto.WalletDebitResponse;
import com.luckystar.game.exception.WalletUnavailableException;
import com.luckystar.game.fishing.FishingSession;
import com.luckystar.game.fishing.FishingSessionStore;
import com.luckystar.game.kafka.GameResultEventPublisher;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.rng.ProvablyFairRng;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * {@link FishingService} 編排邏輯單元測試（純 Mockito，不載入 Spring）。
 * 聚焦「進場扣款後 Session 建立失敗」的退款補償，避免孤兒扣款。
 */
class FishingServiceTest {

    private static final long PLAYER_ID = 1169L;
    private static final long BUY_IN = 5000L;
    private static final int CANNON_LEVEL = 3;

    private final ProvablyFairRng rng = org.mockito.Mockito.mock(ProvablyFairRng.class);
    private final WalletClient walletClient = org.mockito.Mockito.mock(WalletClient.class);
    private final FishingSessionStore sessionStore = org.mockito.Mockito.mock(FishingSessionStore.class);
    private final GameRoundRepository roundRepository = org.mockito.Mockito.mock(GameRoundRepository.class);
    private final GameResultEventPublisher publisher = org.mockito.Mockito.mock(GameResultEventPublisher.class);
    private final ObjectMapper objectMapper = new ObjectMapper();

    private FishingService service;

    @BeforeEach
    void setUp() {
        service = new FishingService(rng, walletClient, sessionStore, roundRepository, publisher, objectMapper);
        when(rng.generateServerSeed()).thenReturn("server-seed");
        when(rng.commit(anyString())).thenReturn("server-seed-hash");
        when(rng.generateClientSeed()).thenReturn("client-seed");
        when(sessionStore.find(PLAYER_ID)).thenReturn(Optional.empty());
        when(walletClient.debit(anyLong(), anyLong(), anyString(), anyString()))
                .thenReturn(new WalletDebitResponse(1L, PLAYER_ID, BUY_IN, 600200L, 595200L, false));
    }

    @Test
    @DisplayName("進場扣款後 Session 存檔失敗 → 自動以補償冪等鍵退款，並上拋原例外")
    void start_whenSessionSaveFails_refundsBuyIn() {
        org.mockito.Mockito.doThrow(new RuntimeException("redis down"))
                .when(sessionStore).save(any(FishingSession.class));
        when(walletClient.credit(anyLong(), anyLong(), anyString(), anyString()))
                .thenReturn(new WalletCreditResponse(2L, PLAYER_ID, BUY_IN, 595200L, 600200L, 0L, false));

        assertThrows(RuntimeException.class,
                () -> service.start(PLAYER_ID, BUY_IN, CANNON_LEVEL, "client-seed"));

        // 必須觸發退款 credit，且冪等鍵為 fishing-buyin-refund-<sessionId>
        ArgumentCaptor<Long> amount = ArgumentCaptor.forClass(Long.class);
        ArgumentCaptor<String> idemKey = ArgumentCaptor.forClass(String.class);
        verify(walletClient).credit(eq(PLAYER_ID), amount.capture(), idemKey.capture(), anyString());
        assertEquals(BUY_IN, amount.getValue());
        assertTrue(idemKey.getValue().startsWith("fishing-buyin-refund-"),
                "退款冪等鍵應為 fishing-buyin-refund- 前綴，實際=" + idemKey.getValue());
    }

    @Test
    @DisplayName("退款本身也失敗時不吞掉原例外（仍上拋，留待人工/排程對帳）")
    void start_whenRefundAlsoFails_stillThrowsOriginal() {
        org.mockito.Mockito.doThrow(new RuntimeException("redis down"))
                .when(sessionStore).save(any(FishingSession.class));
        when(walletClient.credit(anyLong(), anyLong(), anyString(), anyString()))
                .thenThrow(new WalletUnavailableException("wallet down"));

        assertThrows(RuntimeException.class,
                () -> service.start(PLAYER_ID, BUY_IN, CANNON_LEVEL, "client-seed"));

        verify(walletClient).credit(eq(PLAYER_ID), eq(BUY_IN), anyString(), anyString());
    }

    @Test
    @DisplayName("Session 存檔成功時不應退款")
    void start_whenSaveSucceeds_noRefund() {
        // sessionStore.save 預設不丟例外
        service.start(PLAYER_ID, BUY_IN, CANNON_LEVEL, "client-seed");

        verify(sessionStore).save(any(FishingSession.class));
        verify(walletClient, never()).credit(anyLong(), anyLong(), anyString(), anyString());
    }
}
