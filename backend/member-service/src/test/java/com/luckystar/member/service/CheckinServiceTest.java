package com.luckystar.member.service;

import com.luckystar.member.dto.CheckinResponse;
import com.luckystar.member.entity.DailyCheckin;
import com.luckystar.member.exception.AlreadyCheckedInException;
import com.luckystar.member.repository.DailyCheckinRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class CheckinServiceTest {

    @Mock
    private DailyCheckinRepository dailyCheckinRepository;

    @Mock
    private OutboxService outboxService;

    @InjectMocks
    private CheckinService checkinService;

    private static final Long PLAYER_ID = 42L;
    private static final LocalDate TODAY = LocalDate.now(ZoneId.of("Asia/Taipei"));

    // ── Test 1 ───────────────────────────────────────────────────────────

    @Test
    void checkin_alreadyCheckedInToday_throwsAlreadyCheckedInException() {
        when(dailyCheckinRepository.findByPlayerIdAndCheckinDate(PLAYER_ID, TODAY))
                .thenReturn(Optional.of(new DailyCheckin()));

        assertThatThrownBy(() -> checkinService.checkin(PLAYER_ID))
                .isInstanceOf(AlreadyCheckedInException.class);
    }

    // ── Test 2 ───────────────────────────────────────────────────────────

    @Test
    void checkin_noPreviousRecord_consecutiveDaysIsOne() {
        when(dailyCheckinRepository.findByPlayerIdAndCheckinDate(PLAYER_ID, TODAY))
                .thenReturn(Optional.empty());
        when(dailyCheckinRepository.findTopByPlayerIdOrderByCheckinDateDesc(PLAYER_ID))
                .thenReturn(Optional.empty());

        DailyCheckin saved = buildCheckin(1L, PLAYER_ID, TODAY, 1);
        when(dailyCheckinRepository.save(any(DailyCheckin.class))).thenReturn(saved);

        CheckinResponse result = checkinService.checkin(PLAYER_ID);

        assertThat(result.consecutiveDays()).isEqualTo(1);
        assertThat(result.rewardAmount()).isEqualTo(100L);
        verify(dailyCheckinRepository, times(1)).save(any(DailyCheckin.class));
        verify(outboxService, times(1)).save(eq("wallet.credit.request"), eq(String.valueOf(PLAYER_ID)), any());
    }

    // ── Test 3 ───────────────────────────────────────────────────────────

    @Test
    void checkin_lastCheckinYesterday_consecutiveDaysIncremented() {
        DailyCheckin yesterday = buildCheckin(10L, PLAYER_ID, TODAY.minusDays(1), 5);

        when(dailyCheckinRepository.findByPlayerIdAndCheckinDate(PLAYER_ID, TODAY))
                .thenReturn(Optional.empty());
        when(dailyCheckinRepository.findTopByPlayerIdOrderByCheckinDateDesc(PLAYER_ID))
                .thenReturn(Optional.of(yesterday));

        DailyCheckin saved = buildCheckin(11L, PLAYER_ID, TODAY, 6);
        when(dailyCheckinRepository.save(any(DailyCheckin.class))).thenReturn(saved);

        CheckinResponse result = checkinService.checkin(PLAYER_ID);

        assertThat(result.consecutiveDays()).isEqualTo(6);
    }

    @Test
    void checkin_seventhConsecutiveDay_addsMilestoneBonus() {
        DailyCheckin yesterday = buildCheckin(10L, PLAYER_ID, TODAY.minusDays(1), 6);

        when(dailyCheckinRepository.findByPlayerIdAndCheckinDate(PLAYER_ID, TODAY))
                .thenReturn(Optional.empty());
        when(dailyCheckinRepository.findTopByPlayerIdOrderByCheckinDateDesc(PLAYER_ID))
                .thenReturn(Optional.of(yesterday));

        DailyCheckin saved = buildCheckin(11L, PLAYER_ID, TODAY, 7);
        when(dailyCheckinRepository.save(any(DailyCheckin.class))).thenReturn(saved);

        CheckinResponse result = checkinService.checkin(PLAYER_ID);

        assertThat(result.consecutiveDays()).isEqualTo(7);
        assertThat(result.rewardAmount()).isEqualTo(1100L);

        ArgumentCaptor<Object> payloadCaptor = ArgumentCaptor.forClass(Object.class);
        verify(outboxService).save(eq("wallet.credit.request"), eq(String.valueOf(PLAYER_ID)), payloadCaptor.capture());

        @SuppressWarnings("unchecked")
        Map<String, Object> capturedPayload = (Map<String, Object>) payloadCaptor.getValue();
        assertThat(capturedPayload.get("amount")).isEqualTo(1100L);
    }

    // ── Test 4 ───────────────────────────────────────────────────────────

    @Test
    void checkin_lastCheckinTwoDaysAgo_consecutiveDaysReset() {
        DailyCheckin twoDaysAgo = buildCheckin(10L, PLAYER_ID, TODAY.minusDays(2), 5);

        when(dailyCheckinRepository.findByPlayerIdAndCheckinDate(PLAYER_ID, TODAY))
                .thenReturn(Optional.empty());
        when(dailyCheckinRepository.findTopByPlayerIdOrderByCheckinDateDesc(PLAYER_ID))
                .thenReturn(Optional.of(twoDaysAgo));

        DailyCheckin saved = buildCheckin(11L, PLAYER_ID, TODAY, 1);
        when(dailyCheckinRepository.save(any(DailyCheckin.class))).thenReturn(saved);

        CheckinResponse result = checkinService.checkin(PLAYER_ID);

        assertThat(result.consecutiveDays()).isEqualTo(1);
    }

    // ── Test 5 ───────────────────────────────────────────────────────────

    @Test
    void checkin_outboxSaveThrows_propagates() {
        // 行為已改：簽到記錄與發獎事件同一交易，outbox 失敗不再被吞掉而是往上拋（觸發 rollback）
        when(dailyCheckinRepository.findByPlayerIdAndCheckinDate(PLAYER_ID, TODAY))
                .thenReturn(Optional.empty());
        when(dailyCheckinRepository.findTopByPlayerIdOrderByCheckinDateDesc(PLAYER_ID))
                .thenReturn(Optional.empty());

        DailyCheckin saved = buildCheckin(1L, PLAYER_ID, TODAY, 1);
        when(dailyCheckinRepository.save(any(DailyCheckin.class))).thenReturn(saved);
        doThrow(new IllegalStateException("outbox unavailable"))
                .when(outboxService).save(anyString(), anyString(), any());

        assertThatThrownBy(() -> checkinService.checkin(PLAYER_ID))
                .isInstanceOf(IllegalStateException.class);
    }

    // ── Test 6 ───────────────────────────────────────────────────────────

    @Test
    void checkin_idempotencyKey_matchesExpectedFormat() {
        when(dailyCheckinRepository.findByPlayerIdAndCheckinDate(PLAYER_ID, TODAY))
                .thenReturn(Optional.empty());
        when(dailyCheckinRepository.findTopByPlayerIdOrderByCheckinDateDesc(PLAYER_ID))
                .thenReturn(Optional.empty());

        DailyCheckin saved = buildCheckin(1L, PLAYER_ID, TODAY, 1);
        when(dailyCheckinRepository.save(any(DailyCheckin.class))).thenReturn(saved);

        checkinService.checkin(PLAYER_ID);

        // 攔截傳給 outboxService.save 的 payload map
        ArgumentCaptor<Object> payloadCaptor = ArgumentCaptor.forClass(Object.class);
        verify(outboxService).save(eq("wallet.credit.request"), eq(String.valueOf(PLAYER_ID)), payloadCaptor.capture());

        @SuppressWarnings("unchecked")
        Map<String, Object> capturedPayload = (Map<String, Object>) payloadCaptor.getValue();
        String expectedKey = "checkin-" + PLAYER_ID + "-" + TODAY;
        assertThat(capturedPayload.get("idempotencyKey")).isEqualTo(expectedKey);
    }

    // ── helper ───────────────────────────────────────────────────────────

    private DailyCheckin buildCheckin(Long id, Long playerId, LocalDate date, int days) {
        DailyCheckin c = new DailyCheckin();
        c.setId(id);
        c.setPlayerId(playerId);
        c.setCheckinDate(date);
        c.setConsecutiveDays(days);
        return c;
    }
}
