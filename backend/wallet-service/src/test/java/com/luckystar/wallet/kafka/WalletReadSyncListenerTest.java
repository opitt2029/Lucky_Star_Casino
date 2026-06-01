package com.luckystar.wallet.kafka;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.mysql.entity.WalletTransactionView;
import com.luckystar.wallet.mysql.repository.WalletTransactionViewRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.kafka.support.Acknowledgment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link WalletReadSyncListener} 單元測試。
 *
 * <p>覆蓋：正常同步、冪等跳過（重送）、JSON 格式錯誤（不可重試直送 DLT）、
 * 暫時性 DB 失敗（往外拋不 ack 觸發重試）。以真實 {@link ObjectMapper} 序列化測試 payload。
 */
@ExtendWith(MockitoExtension.class)
class WalletReadSyncListenerTest {

    @Mock
    private WalletTransactionViewRepository viewRepository;

    @Mock
    private Acknowledgment ack;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private WalletReadSyncListener listenerWithRealMapper() {
        return new WalletReadSyncListener(viewRepository, objectMapper);
    }

    @Test
    void onDebit_validJson_idNotInDb_savesAndAcks() throws Exception {
        WalletReadSyncListener target = listenerWithRealMapper();
        WalletDebitEvent event = new WalletDebitEvent(100L, 7L, 500L, 1000L, 500L, "BET", "idem-1", "ref-1");
        String message = objectMapper.writeValueAsString(event);
        when(viewRepository.existsById(100L)).thenReturn(false);

        target.onDebit(message, ack);

        ArgumentCaptor<WalletTransactionView> captor = ArgumentCaptor.forClass(WalletTransactionView.class);
        verify(viewRepository).save(captor.capture());
        WalletTransactionView saved = captor.getValue();
        assertThat(saved.getId()).isEqualTo(100L);
        assertThat(saved.getPlayerId()).isEqualTo(7L);
        assertThat(saved.getType()).isEqualTo("DEBIT");
        assertThat(saved.getSubType()).isEqualTo("BET");
        assertThat(saved.getAmount()).isEqualTo(500L);
        assertThat(saved.getBalanceBefore()).isEqualTo(1000L);
        assertThat(saved.getBalanceAfter()).isEqualTo(500L);
        assertThat(saved.getReferenceId()).isEqualTo("ref-1");
        assertThat(saved.getCreatedAt()).isNotNull();
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void onDebit_giftSubType_isPreservedInReadModel() throws Exception {
        // T-026：贈送出帳事件帶 subType=GIFT，讀庫應如實記錄（而非一律 BET）
        WalletReadSyncListener target = listenerWithRealMapper();
        WalletDebitEvent event = new WalletDebitEvent(101L, 7L, 500L, 1000L, 500L, "GIFT", "gift-1:gift:debit", "gift-to:8");
        String message = objectMapper.writeValueAsString(event);
        when(viewRepository.existsById(101L)).thenReturn(false);

        target.onDebit(message, ack);

        ArgumentCaptor<WalletTransactionView> captor = ArgumentCaptor.forClass(WalletTransactionView.class);
        verify(viewRepository).save(captor.capture());
        assertThat(captor.getValue().getSubType()).isEqualTo("GIFT");
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void onDebit_nullSubType_fallsBackToBet() throws Exception {
        // 相容舊訊息：無 subType（null）回退為 BET
        WalletReadSyncListener target = listenerWithRealMapper();
        String legacyMessage =
                "{\"transactionId\":102,\"playerId\":7,\"amount\":500,\"balanceBefore\":1000,\"balanceAfter\":500,\"idempotencyKey\":\"idem-x\",\"referenceId\":\"ref-x\"}";
        when(viewRepository.existsById(102L)).thenReturn(false);

        target.onDebit(legacyMessage, ack);

        ArgumentCaptor<WalletTransactionView> captor = ArgumentCaptor.forClass(WalletTransactionView.class);
        verify(viewRepository).save(captor.capture());
        assertThat(captor.getValue().getSubType()).isEqualTo("BET");
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void onDebit_duplicateId_skipsSaveButAcks() throws Exception {
        WalletReadSyncListener target = listenerWithRealMapper();
        WalletDebitEvent event = new WalletDebitEvent(100L, 7L, 500L, 1000L, 500L, "BET", "idem-1", "ref-1");
        String message = objectMapper.writeValueAsString(event);
        when(viewRepository.existsById(100L)).thenReturn(true);

        target.onDebit(message, ack);

        verify(viewRepository, never()).save(any());
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void onDebit_malformedJson_propagatesAndNeverAcks() {
        WalletReadSyncListener target = listenerWithRealMapper();
        String malformed = "{not valid json";

        assertThatThrownBy(() -> target.onDebit(malformed, ack))
                .isInstanceOf(JsonProcessingException.class);

        verify(viewRepository, never()).save(any());
        verify(ack, never()).acknowledge();
    }

    @Test
    void onDebit_saveThrows_propagatesAndNeverAcks() throws Exception {
        WalletReadSyncListener target = listenerWithRealMapper();
        WalletDebitEvent event = new WalletDebitEvent(100L, 7L, 500L, 1000L, 500L, "BET", "idem-1", "ref-1");
        String message = objectMapper.writeValueAsString(event);
        when(viewRepository.existsById(100L)).thenReturn(false);
        DataAccessException ex = new DataAccessResourceFailureException("DB down");
        when(viewRepository.save(any())).thenThrow(ex);

        assertThatThrownBy(() -> target.onDebit(message, ack))
                .isInstanceOf(DataAccessException.class);

        verify(ack, never()).acknowledge();
    }

    @Test
    void onCredit_validJson_idNotInDb_savesAndAcks() throws Exception {
        WalletReadSyncListener target = listenerWithRealMapper();
        WalletCreditEvent event =
                new WalletCreditEvent(200L, 9L, 300L, 700L, 1000L, "CHECKIN", "idem-2", "ref-2");
        String message = objectMapper.writeValueAsString(event);
        when(viewRepository.existsById(200L)).thenReturn(false);

        target.onCredit(message, ack);

        ArgumentCaptor<WalletTransactionView> captor = ArgumentCaptor.forClass(WalletTransactionView.class);
        verify(viewRepository).save(captor.capture());
        WalletTransactionView saved = captor.getValue();
        assertThat(saved.getId()).isEqualTo(200L);
        assertThat(saved.getPlayerId()).isEqualTo(9L);
        assertThat(saved.getType()).isEqualTo("CREDIT");
        assertThat(saved.getSubType()).isEqualTo("CHECKIN");
        assertThat(saved.getAmount()).isEqualTo(300L);
        assertThat(saved.getBalanceBefore()).isEqualTo(700L);
        assertThat(saved.getBalanceAfter()).isEqualTo(1000L);
        assertThat(saved.getReferenceId()).isEqualTo("ref-2");
        assertThat(saved.getCreatedAt()).isNotNull();
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void onCredit_duplicateId_skipsSaveButAcks() throws Exception {
        WalletReadSyncListener target = listenerWithRealMapper();
        WalletCreditEvent event =
                new WalletCreditEvent(200L, 9L, 300L, 700L, 1000L, "WIN", "idem-2", "ref-2");
        String message = objectMapper.writeValueAsString(event);
        when(viewRepository.existsById(200L)).thenReturn(true);

        target.onCredit(message, ack);

        verify(viewRepository, never()).save(any());
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void onCredit_malformedJson_propagatesAndNeverAcks() {
        WalletReadSyncListener target = listenerWithRealMapper();
        String malformed = "{not valid json";

        assertThatThrownBy(() -> target.onCredit(malformed, ack))
                .isInstanceOf(JsonProcessingException.class);

        verify(viewRepository, never()).save(any());
        verify(ack, never()).acknowledge();
    }
}
