package com.luckystar.wallet.kafka;

import com.luckystar.wallet.service.DeadLetterService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.support.Acknowledgment;

import java.nio.charset.StandardCharsets;

import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * {@link DeadLetterListener} 單元測試（T-028）。
 *
 * <p>覆蓋：正常解析 header 落庫並 ack、缺 original-topic header 回退預設、
 * record 拋例外仍照常 ack（try/finally，避免卡 partition）。
 */
@ExtendWith(MockitoExtension.class)
class DeadLetterListenerTest {

    @Mock
    private DeadLetterService deadLetterService;

    @Mock
    private Acknowledgment ack;

    @InjectMocks
    private DeadLetterListener listener;

    private byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void onCreditDlt_validHeaders_recordsAndAcks() {
        listener.onCreditDlt(
                "{\"a\":1}",
                bytes("wallet.credit"),
                "7",
                bytes("java.lang.RuntimeException"),
                bytes("boom"),
                bytes("stacktrace"),
                ack);

        verify(deadLetterService).record(
                "wallet.credit.DLT", "wallet.credit", "7", "{\"a\":1}",
                "java.lang.RuntimeException", "boom", "stacktrace");
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void onDebitDlt_nullOriginalTopicHeader_fallsBackToDefault() {
        listener.onDebitDlt(
                "{\"b\":2}",
                null,          // 缺 DLT_ORIGINAL_TOPIC header
                null,          // 無 key
                null,
                null,
                null,
                ack);

        verify(deadLetterService).record(
                "wallet.debit.DLT", "wallet.debit", null, "{\"b\":2}",
                null, null, null);
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void onCreditRequestDlt_validHeaders_recordsWithRequestTopics() {
        listener.onCreditRequestDlt(
                "{\"c\":3}",
                bytes("wallet.credit.request"),
                "9",
                bytes("com.luckystar.wallet.exception.WalletNotFoundException"),
                bytes("wallet not found"),
                bytes("stacktrace"),
                ack);

        verify(deadLetterService).record(
                "wallet.credit.request.DLT", "wallet.credit.request", "9", "{\"c\":3}",
                "com.luckystar.wallet.exception.WalletNotFoundException", "wallet not found", "stacktrace");
        verify(ack, times(1)).acknowledge();
    }

    @Test
    void onCreditDlt_recordThrows_stillAcks() {
        doThrow(new RuntimeException("unexpected"))
                .when(deadLetterService)
                .record(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.any(),
                        org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.any(),
                        org.mockito.ArgumentMatchers.any(),
                        org.mockito.ArgumentMatchers.any());

        listener.onCreditDlt(
                "{\"a\":1}",
                bytes("wallet.credit"),
                "7",
                bytes("E"),
                bytes("msg"),
                bytes("trace"),
                ack);

        // try/finally 保證即使 record 拋例外，ack 仍被呼叫。
        verify(ack, times(1)).acknowledge();
    }
}
