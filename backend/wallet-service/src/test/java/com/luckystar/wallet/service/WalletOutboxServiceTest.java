package com.luckystar.wallet.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.postgres.entity.WalletOutbox;
import com.luckystar.wallet.postgres.repository.WalletOutboxRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link WalletOutboxService} 單元測試（藍圖 04 P2）：驗證「寫進交易內的 outbox 列」語意——
 * 序列化 payload、狀態 PENDING；序列化失敗要拋出讓交易回滾（不可留無聲缺口）。
 */
@ExtendWith(MockitoExtension.class)
class WalletOutboxServiceTest {

    @Mock WalletOutboxRepository walletOutboxRepository;

    @Test
    void save_persistsPendingRowWithSerializedPayload() throws Exception {
        // 用真的 ObjectMapper 驗證序列化實際發生
        WalletOutboxService service = new WalletOutboxService(walletOutboxRepository, new ObjectMapper());

        service.save("wallet.credit", "42", new SamplePayload(42L, 500L));

        ArgumentCaptor<WalletOutbox> captor = ArgumentCaptor.forClass(WalletOutbox.class);
        verify(walletOutboxRepository).save(captor.capture());
        WalletOutbox saved = captor.getValue();
        assertThat(saved.getTopic()).isEqualTo("wallet.credit");
        assertThat(saved.getKafkaKey()).isEqualTo("42");
        assertThat(saved.getStatus()).isEqualTo(WalletOutbox.STATUS_PENDING);
        assertThat(saved.getRetryCount()).isZero();
        assertThat(saved.getSentAt()).isNull();
        assertThat(saved.getPayload()).contains("\"playerId\":42").contains("\"amount\":500");
    }

    @Test
    void save_serializationFailure_throwsAndDoesNotPersist() throws Exception {
        // mock ObjectMapper 丟 JsonProcessingException（實務上幾乎不可能，代表程式錯誤）
        ObjectMapper objectMapper = org.mockito.Mockito.mock(ObjectMapper.class);
        when(objectMapper.writeValueAsString(org.mockito.ArgumentMatchers.any()))
                .thenThrow(new JsonProcessingException("boom") {});
        WalletOutboxService service = new WalletOutboxService(walletOutboxRepository, objectMapper);

        // 序列化失敗必須往上拋 → 讓外層交易 rollback（帳務也一起失敗，而非留無聲缺口）
        assertThatThrownBy(() -> service.save("wallet.credit", "42", new SamplePayload(42L, 500L)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("wallet.credit");

        verify(walletOutboxRepository, never()).save(org.mockito.ArgumentMatchers.any());
    }

    private record SamplePayload(Long playerId, Long amount) {}
}
