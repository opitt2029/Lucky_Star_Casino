package com.luckystar.wallet.kafka;

import com.fasterxml.jackson.core.JsonParseException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.dto.CreditRequest;
import com.luckystar.wallet.service.WalletService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.support.Acknowledgment;

import static org.assertj.core.api.Assertions.assertThat;
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
class WalletCreditRequestListenerTest {

    @Mock
    WalletService walletService;

    @Mock
    ObjectMapper objectMapper;

    @InjectMocks
    WalletCreditRequestListener listener;

    private static final String VALID_JSON =
            "{\"playerId\":42,\"amount\":50,\"subType\":\"CHECKIN\",\"idempotencyKey\":\"checkin-42-2026-05-29\",\"consecutiveDays\":3}";

    @Test
    void handleCreditRequest_validJson_callsCreditWithMappedFieldsAndAcks() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        WalletCreditRequestEvent event =
                new WalletCreditRequestEvent(42L, 50L, "CHECKIN", "checkin-42-2026-05-29", null);
        when(objectMapper.readValue(VALID_JSON, WalletCreditRequestEvent.class)).thenReturn(event);

        listener.handleCreditRequest(VALID_JSON, ack);

        // 驗證指令被正確對映成 CreditRequest 傳入 credit()
        ArgumentCaptor<CreditRequest> captor = ArgumentCaptor.forClass(CreditRequest.class);
        verify(walletService, times(1)).credit(captor.capture());
        CreditRequest req = captor.getValue();
        assertThat(req.getPlayerId()).isEqualTo(42L);
        assertThat(req.getAmount()).isEqualTo(50L);
        assertThat(req.getSubType()).isEqualTo("CHECKIN");
        assertThat(req.getIdempotencyKey()).isEqualTo("checkin-42-2026-05-29");

        verify(ack, times(1)).acknowledge();
    }

    @Test
    void handleCreditRequest_invalidJson_throwsAndDoesNotAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        when(objectMapper.readValue(any(String.class), eq(WalletCreditRequestEvent.class)))
                .thenThrow(new JsonParseException(null, "bad json"));

        // 格式錯誤 → 不可重試，直送 DLT，不可 ack
        assertThatThrownBy(() -> listener.handleCreditRequest("not-json", ack))
                .isInstanceOf(JsonParseException.class);

        verify(walletService, never()).credit(any());
        verify(ack, never()).acknowledge();
    }

    @Test
    void handleCreditRequest_creditThrows_doesNotAck() throws Exception {
        Acknowledgment ack = mock(Acknowledgment.class);
        WalletCreditRequestEvent event =
                new WalletCreditRequestEvent(99L, 100L, "GM_REWARD", "new-gift-99", null);
        when(objectMapper.readValue(VALID_JSON, WalletCreditRequestEvent.class)).thenReturn(event);
        doThrow(new RuntimeException("DB down")).when(walletService).credit(any());

        // 暫時性失敗往外拋 → error handler 重試/送 DLT，不可 ack 否則入帳指令遺失
        assertThatThrownBy(() -> listener.handleCreditRequest(VALID_JSON, ack))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("DB down");

        verify(ack, never()).acknowledge();
    }
}
