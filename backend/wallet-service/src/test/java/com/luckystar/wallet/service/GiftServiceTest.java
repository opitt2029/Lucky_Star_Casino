package com.luckystar.wallet.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.wallet.dto.GiftRequest;
import com.luckystar.wallet.dto.GiftResponse;
import com.luckystar.wallet.exception.GiftLimitExceededException;
import com.luckystar.wallet.exception.InsufficientBalanceException;
import com.luckystar.wallet.exception.InvalidGiftException;
import com.luckystar.wallet.exception.WalletNotFoundException;
import com.luckystar.wallet.postgres.entity.WalletTransaction;
import com.luckystar.wallet.postgres.repository.WalletTransactionRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.kafka.core.KafkaTemplate;

import java.time.Instant;
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
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link GiftService} 單元測試（T-026）。
 *
 * <p>全程 Mockito mock 掉 {@link GiftTransferService}（原子轉帳）、{@link GiftLogService}（稽核）、
 * Redis、Kafka、ObjectMapper 與 repository，聚焦協調邏輯：冪等預檢、Redis 預扣/回補、
 * best-effort 下游失敗不影響金流。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class GiftServiceTest {

    @Mock GiftTransferService giftTransferService;
    @Mock GiftLogService giftLogService;
    @Mock WalletTransactionRepository walletTransactionRepository;
    @Mock StringRedisTemplate redisTemplate;
    @Mock ValueOperations<String, String> valueOps;
    @Mock KafkaTemplate<String, String> kafkaTemplate;
    @Mock ObjectMapper objectMapper;

    private GiftService giftService() {
        return new GiftService(giftTransferService, giftLogService, walletTransactionRepository,
                redisTemplate, kafkaTemplate, objectMapper);
    }

    private GiftRequest request(Long receiverId, long amount, String key) {
        GiftRequest req = new GiftRequest();
        req.setReceiverId(receiverId);
        req.setAmount(amount);
        req.setIdempotencyKey(key);
        return req;
    }

    private WalletTransaction tx(Long id, Long playerId, String type, long amount,
                                 long before, long after, String idemKey) {
        return WalletTransaction.builder()
                .id(id).playerId(playerId).type(type).subType("GIFT")
                .amount(amount).balanceBefore(before).balanceAfter(after)
                .idempotencyKey(idemKey).build();
    }

    /** 預扣成功（兩個計數都在上限內）的 Redis 樁。 */
    private void stubReserveOk(long sentTotal, long recvTotal) {
        when(redisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.increment(anyString(), anyLong()))
                .thenReturn(sentTotal)   // 第一次：sent
                .thenReturn(recvTotal);  // 第二次：recv
        when(redisTemplate.getExpire(anyString())).thenReturn(-1L);
        when(redisTemplate.expireAt(anyString(), any(Instant.class))).thenReturn(true);
    }

    @Test
    void gift_success_reservesTransfersLogsAndPublishes() throws Exception {
        GiftService service = giftService();
        GiftRequest req = request(2L, 500L, "g1");

        when(walletTransactionRepository.findByIdempotencyKey("g1:gift:debit")).thenReturn(Optional.empty());
        stubReserveOk(500L, 500L);
        WalletTransaction debit = tx(10L, 1L, "DEBIT", 500L, 1000L, 500L, "g1:gift:debit");
        WalletTransaction credit = tx(11L, 2L, "CREDIT", 500L, 200L, 700L, "g1:gift:credit");
        when(giftTransferService.transfer(1L, 2L, 500L, "g1:gift:debit", "g1:gift:credit"))
                .thenReturn(new GiftTransferService.Result(debit, credit));
        when(objectMapper.writeValueAsString(any())).thenReturn("{}");

        GiftResponse resp = service.gift(1L, req);

        verify(giftTransferService).transfer(1L, 2L, 500L, "g1:gift:debit", "g1:gift:credit");
        verify(giftLogService).record(1L, 2L, 500L);
        verify(kafkaTemplate).send(eq("wallet.debit"), eq("1"), anyString());
        verify(kafkaTemplate).send(eq("wallet.credit"), eq("2"), anyString());
        verify(valueOps, never()).decrement(anyString(), anyLong());

        assertThat(resp.isIdempotent()).isFalse();
        assertThat(resp.getDebitTransactionId()).isEqualTo(10L);
        assertThat(resp.getCreditTransactionId()).isEqualTo(11L);
        assertThat(resp.getSenderBalanceAfter()).isEqualTo(500L);
        assertThat(resp.getReceiverBalanceAfter()).isEqualTo(700L);
    }

    @Test
    void gift_toSelf_throwsInvalidGift_noSideEffects() {
        GiftService service = giftService();

        assertThatThrownBy(() -> service.gift(1L, request(1L, 500L, "g-self")))
                .isInstanceOf(InvalidGiftException.class);

        verifyNoInteractions(redisTemplate, giftTransferService, giftLogService, kafkaTemplate);
    }

    @Test
    void gift_idempotentReplay_returnsExistingNoRedisNoTransfer() {
        GiftService service = giftService();
        WalletTransaction debit = tx(10L, 1L, "DEBIT", 500L, 1000L, 500L, "g1:gift:debit");
        WalletTransaction credit = tx(11L, 2L, "CREDIT", 500L, 200L, 700L, "g1:gift:credit");
        when(walletTransactionRepository.findByIdempotencyKey("g1:gift:debit")).thenReturn(Optional.of(debit));
        when(walletTransactionRepository.findByIdempotencyKey("g1:gift:credit")).thenReturn(Optional.of(credit));

        GiftResponse resp = service.gift(1L, request(2L, 500L, "g1"));

        assertThat(resp.isIdempotent()).isTrue();
        assertThat(resp.getDebitTransactionId()).isEqualTo(10L);
        assertThat(resp.getCreditTransactionId()).isEqualTo(11L);
        assertThat(resp.getReceiverBalanceAfter()).isEqualTo(700L);
        verifyNoInteractions(redisTemplate, giftTransferService, giftLogService, kafkaTemplate);
    }

    @Test
    void gift_sentLimitExceeded_rollsBackRedisAndThrows() {
        GiftService service = giftService();
        when(walletTransactionRepository.findByIdempotencyKey("g2:gift:debit")).thenReturn(Optional.empty());
        // sent 預扣後達 6000（>5000），recv 仍在上限內
        stubReserveOk(6000L, 500L);

        assertThatThrownBy(() -> service.gift(1L, request(2L, 6000L, "g2")))
                .isInstanceOf(GiftLimitExceededException.class)
                .hasMessageContaining("sent");

        // 兩個計數都回補
        verify(valueOps, times(1)).decrement("wallet:gift:sent:1:" + today(), 6000L);
        verify(valueOps, times(1)).decrement("wallet:gift:recv:2:" + today(), 6000L);
        verifyNoInteractions(giftTransferService, giftLogService, kafkaTemplate);
    }

    @Test
    void gift_recvLimitExceeded_rollsBackRedisAndThrows() {
        GiftService service = giftService();
        when(walletTransactionRepository.findByIdempotencyKey("g3:gift:debit")).thenReturn(Optional.empty());
        // sent 在上限內，recv 達 11000（>10000）
        stubReserveOk(500L, 11000L);

        assertThatThrownBy(() -> service.gift(1L, request(2L, 500L, "g3")))
                .isInstanceOf(GiftLimitExceededException.class)
                .hasMessageContaining("received");

        verify(valueOps).decrement("wallet:gift:sent:1:" + today(), 500L);
        verify(valueOps).decrement("wallet:gift:recv:2:" + today(), 500L);
        verifyNoInteractions(giftTransferService, giftLogService, kafkaTemplate);
    }

    @Test
    void gift_insufficientBalance_releasesRedisAndPropagates() {
        GiftService service = giftService();
        when(walletTransactionRepository.findByIdempotencyKey("g4:gift:debit")).thenReturn(Optional.empty());
        stubReserveOk(500L, 500L);
        when(giftTransferService.transfer(anyLong(), anyLong(), anyLong(), anyString(), anyString()))
                .thenThrow(new InsufficientBalanceException("Insufficient balance"));

        assertThatThrownBy(() -> service.gift(1L, request(2L, 500L, "g4")))
                .isInstanceOf(InsufficientBalanceException.class);

        verify(valueOps).decrement("wallet:gift:sent:1:" + today(), 500L);
        verify(valueOps).decrement("wallet:gift:recv:2:" + today(), 500L);
        verifyNoInteractions(giftLogService, kafkaTemplate);
    }

    @Test
    void gift_walletNotFound_releasesRedisAndPropagates() {
        GiftService service = giftService();
        when(walletTransactionRepository.findByIdempotencyKey("g5:gift:debit")).thenReturn(Optional.empty());
        stubReserveOk(500L, 500L);
        when(giftTransferService.transfer(anyLong(), anyLong(), anyLong(), anyString(), anyString()))
                .thenThrow(new WalletNotFoundException("Wallet not found for receiver: 2"));

        assertThatThrownBy(() -> service.gift(1L, request(2L, 500L, "g5")))
                .isInstanceOf(WalletNotFoundException.class);

        verify(valueOps).decrement("wallet:gift:sent:1:" + today(), 500L);
        verify(valueOps).decrement("wallet:gift:recv:2:" + today(), 500L);
    }

    @Test
    void gift_concurrentDuplicate_releasesRedisAndReturnsIdempotent() {
        GiftService service = giftService();
        WalletTransaction debit = tx(10L, 1L, "DEBIT", 500L, 1000L, 500L, "g6:gift:debit");
        WalletTransaction credit = tx(11L, 2L, "CREDIT", 500L, 200L, 700L, "g6:gift:credit");
        when(walletTransactionRepository.findByIdempotencyKey("g6:gift:debit"))
                .thenReturn(Optional.empty())          // 預檢：尚未存在
                .thenReturn(Optional.of(debit));        // UNIQUE 衝突後回查贏家
        when(walletTransactionRepository.findByIdempotencyKey("g6:gift:credit")).thenReturn(Optional.of(credit));
        stubReserveOk(500L, 500L);
        when(giftTransferService.transfer(anyLong(), anyLong(), anyLong(), anyString(), anyString()))
                .thenThrow(new DataIntegrityViolationException("duplicate idempotency_key"));

        GiftResponse resp = service.gift(1L, request(2L, 500L, "g6"));

        assertThat(resp.isIdempotent()).isTrue();
        assertThat(resp.getDebitTransactionId()).isEqualTo(10L);
        verify(valueOps).decrement("wallet:gift:sent:1:" + today(), 500L);
        verify(valueOps).decrement("wallet:gift:recv:2:" + today(), 500L);
        verifyNoInteractions(giftLogService, kafkaTemplate);
    }

    @Test
    void gift_giftLogFailure_doesNotFailRequest() throws Exception {
        GiftService service = giftService();
        when(walletTransactionRepository.findByIdempotencyKey("g7:gift:debit")).thenReturn(Optional.empty());
        stubReserveOk(500L, 500L);
        WalletTransaction debit = tx(10L, 1L, "DEBIT", 500L, 1000L, 500L, "g7:gift:debit");
        WalletTransaction credit = tx(11L, 2L, "CREDIT", 500L, 200L, 700L, "g7:gift:credit");
        when(giftTransferService.transfer(anyLong(), anyLong(), anyLong(), anyString(), anyString()))
                .thenReturn(new GiftTransferService.Result(debit, credit));
        org.mockito.Mockito.doThrow(new RuntimeException("MySQL down"))
                .when(giftLogService).record(anyLong(), anyLong(), anyLong());
        when(objectMapper.writeValueAsString(any())).thenReturn("{}");

        GiftResponse resp = service.gift(1L, request(2L, 500L, "g7"));

        // 金流已 commit，稽核失敗不影響回應，事件照常發布
        assertThat(resp.isIdempotent()).isFalse();
        verify(kafkaTemplate).send(eq("wallet.debit"), eq("1"), anyString());
        verify(kafkaTemplate).send(eq("wallet.credit"), eq("2"), anyString());
    }

    @Test
    void gift_kafkaFailure_doesNotFailRequest() throws Exception {
        GiftService service = giftService();
        when(walletTransactionRepository.findByIdempotencyKey("g8:gift:debit")).thenReturn(Optional.empty());
        stubReserveOk(500L, 500L);
        WalletTransaction debit = tx(10L, 1L, "DEBIT", 500L, 1000L, 500L, "g8:gift:debit");
        WalletTransaction credit = tx(11L, 2L, "CREDIT", 500L, 200L, 700L, "g8:gift:credit");
        when(giftTransferService.transfer(anyLong(), anyLong(), anyLong(), anyString(), anyString()))
                .thenReturn(new GiftTransferService.Result(debit, credit));
        when(objectMapper.writeValueAsString(any()))
                .thenThrow(new com.fasterxml.jackson.core.JsonProcessingException("boom") {});

        GiftResponse resp = service.gift(1L, request(2L, 500L, "g8"));

        assertThat(resp.isIdempotent()).isFalse();
        verify(giftLogService).record(1L, 2L, 500L);
    }

    private static String today() {
        return java.time.LocalDate.now(java.time.ZoneId.of("Asia/Taipei")).toString();
    }
}
