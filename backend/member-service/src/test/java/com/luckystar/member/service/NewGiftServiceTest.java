package com.luckystar.member.service;

import com.luckystar.member.entity.Member;
import com.luckystar.member.repository.MemberRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class NewGiftServiceTest {

    @Mock
    private MemberRepository memberRepository;

    @Mock
    private OutboxService outboxService;

    @InjectMocks
    private NewGiftService newGiftService;

    private static final Long PLAYER_ID = 42L;

    // ── Test 1 ───────────────────────────────────────────────────────────

    @Test
    void processNewGift_memberNotFound_logsWarningAndSkips() {
        when(memberRepository.findById(PLAYER_ID)).thenReturn(Optional.empty());

        newGiftService.processNewGift(PLAYER_ID);

        verify(memberRepository, never()).save(any());
        verify(outboxService, never()).save(anyString(), anyString(), any());
    }

    // ── Test 2 ───────────────────────────────────────────────────────────

    @Test
    void processNewGift_giftAlreadyClaimed_logsInfoAndSkips() {
        Member member = buildMember(PLAYER_ID, true);
        when(memberRepository.findById(PLAYER_ID)).thenReturn(Optional.of(member));

        newGiftService.processNewGift(PLAYER_ID);

        verify(memberRepository, never()).save(any());
        verify(outboxService, never()).save(anyString(), anyString(), any());
    }

    // ── Test 3 ───────────────────────────────────────────────────────────

    @Test
    void processNewGift_notYetClaimed_setsFlagSavesAndWritesOutbox() {
        Member member = buildMember(PLAYER_ID, false);
        when(memberRepository.findById(PLAYER_ID)).thenReturn(Optional.of(member));

        newGiftService.processNewGift(PLAYER_ID);

        assertThat(member.getIsNewGiftClaimed()).isTrue();
        verify(memberRepository, times(1)).save(member);
        verify(outboxService, times(1))
                .save(eq("wallet.credit.request"), eq(String.valueOf(PLAYER_ID)), any());
    }

    // ── Test 4 ───────────────────────────────────────────────────────────

    @Test
    void processNewGift_idempotencyKey_matchesExpectedFormat() {
        Member member = buildMember(PLAYER_ID, false);
        when(memberRepository.findById(PLAYER_ID)).thenReturn(Optional.of(member));

        newGiftService.processNewGift(PLAYER_ID);

        ArgumentCaptor<Object> payloadCaptor = ArgumentCaptor.forClass(Object.class);
        verify(outboxService).save(eq("wallet.credit.request"), eq(String.valueOf(PLAYER_ID)), payloadCaptor.capture());

        @SuppressWarnings("unchecked")
        Map<String, Object> capturedPayload = (Map<String, Object>) payloadCaptor.getValue();
        assertThat(capturedPayload.get("idempotencyKey")).isEqualTo("new-gift-" + PLAYER_ID);
    }

    // ── Test 5 ───────────────────────────────────────────────────────────

    @Test
    void processNewGift_outboxThrows_saveWasCalledBeforeThrow() {
        Member member = buildMember(PLAYER_ID, false);
        when(memberRepository.findById(PLAYER_ID)).thenReturn(Optional.of(member));
        doThrow(new IllegalStateException("outbox unavailable"))
                .when(outboxService).save(anyString(), anyString(), any());

        assertThatThrownBy(() -> newGiftService.processNewGift(PLAYER_ID))
                .isInstanceOf(IllegalStateException.class);

        // 旗標 save() 在 outbox 寫入之前已被呼叫（兩者同一交易，會一起回滾）
        verify(memberRepository, times(1)).save(member);
    }

    // ── helper ───────────────────────────────────────────────────────────

    private Member buildMember(Long id, boolean giftClaimed) {
        Member m = new Member();
        m.setId(id);
        m.setUsername("player" + id);
        m.setEmail("player" + id + "@example.com");
        m.setPasswordHash("hashed");
        m.setNickname("Player" + id);
        m.setIsNewGiftClaimed(giftClaimed);
        return m;
    }
}
