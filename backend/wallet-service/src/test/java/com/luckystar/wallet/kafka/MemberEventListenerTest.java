package com.luckystar.wallet.kafka;

import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.service.DiamondWalletService;
import com.luckystar.wallet.service.WalletService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.support.Acknowledgment;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MemberEventListenerTest {

    @Mock
    WalletService walletService;

    @Mock
    DiamondWalletService diamondWalletService;

    @Mock
    ObjectMapper objectMapper;

    @InjectMocks
    MemberEventListener listener;

    private static final String VALID_JSON =
            "{\"playerId\":42,\"username\":\"testuser\",\"email\":\"test@example.com\"}";

    @Test
    void handleMemberRegistered_validJson_createsBothWalletsAndAcks() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        MemberRegisteredEvent event = new MemberRegisteredEvent(42L, "testuser", "test@example.com");
        when(objectMapper.readValue(VALID_JSON, MemberRegisteredEvent.class)).thenReturn(event);

        listener.handleMemberRegistered(VALID_JSON, ack);

        // 星幣（T-020）與鑽石（T-101）開戶都要被觸發，且最後才 ack
        verify(walletService, times(1)).createWallet(42L);
        verify(diamondWalletService, times(1)).createDiamondWallet(42L);
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void handleMemberRegistered_invalidJson_throwsAndDoesNotAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        when(objectMapper.readValue(any(String.class), eq(MemberRegisteredEvent.class)))
                .thenThrow(new JsonParseException(null, "bad json"));

        // 格式錯誤拋出 → DefaultErrorHandler 標為不可重試，直送 DLT，不可在此 ack
        assertThatThrownBy(() -> listener.handleMemberRegistered("not-json", ack))
                .isInstanceOf(JsonParseException.class);

        verify(walletService, never()).createWallet(any());
        verify(diamondWalletService, never()).createDiamondWallet(any());
        verify(ack, never()).acknowledge();
    }

    @Test
    void handleMemberRegistered_createWalletThrows_doesNotCreateDiamondOrAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        MemberRegisteredEvent event = new MemberRegisteredEvent(99L, "user", "user@example.com");
        when(objectMapper.readValue(VALID_JSON, MemberRegisteredEvent.class)).thenReturn(event);
        doThrow(new RuntimeException("DB down")).when(walletService).createWallet(99L);

        // 暫時性失敗往外拋 → error handler 重試/送 DLT，不可 ack 否則事件遺失
        assertThatThrownBy(() -> listener.handleMemberRegistered(VALID_JSON, ack))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("DB down");

        // 星幣開戶先失敗 → 鑽石開戶不應被觸發、不可 ack
        verify(diamondWalletService, never()).createDiamondWallet(any());
        verify(ack, never()).acknowledge();
    }

    @Test
    void handleMemberRegistered_createDiamondWalletThrows_doesNotAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        MemberRegisteredEvent event = new MemberRegisteredEvent(7L, "user", "user@example.com");
        when(objectMapper.readValue(VALID_JSON, MemberRegisteredEvent.class)).thenReturn(event);
        doThrow(new RuntimeException("DB down")).when(diamondWalletService).createDiamondWallet(7L);

        // 鑽石開戶失敗同樣往外拋 → 不 ack，事件由 error handler 重試（兩開戶皆冪等，重跑安全）
        assertThatThrownBy(() -> listener.handleMemberRegistered(VALID_JSON, ack))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("DB down");

        verify(walletService, times(1)).createWallet(7L);
        verify(ack, never()).acknowledge();
    }
}
