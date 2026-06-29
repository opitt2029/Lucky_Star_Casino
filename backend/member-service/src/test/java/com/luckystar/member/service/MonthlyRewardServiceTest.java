package com.luckystar.member.service;

import com.luckystar.member.dto.CheckinStatusResponse;
import com.luckystar.member.dto.MonthlyMilestoneStatus;
import com.luckystar.member.dto.MonthlyRewardClaimResponse;
import com.luckystar.member.entity.DailyCheckin;
import com.luckystar.member.entity.MonthlyRewardClaim;
import com.luckystar.member.exception.InvalidMonthlyMilestoneException;
import com.luckystar.member.exception.MonthlyRewardAlreadyClaimedException;
import com.luckystar.member.exception.MonthlyRewardNotEligibleException;
import com.luckystar.member.repository.DailyCheckinRepository;
import com.luckystar.member.repository.MonthlyRewardClaimRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MonthlyRewardServiceTest {

    @Mock
    private DailyCheckinRepository dailyCheckinRepository;

    @Mock
    private MonthlyRewardClaimRepository monthlyRewardClaimRepository;

    @Mock
    private OutboxService outboxService;

    @InjectMocks
    private MonthlyRewardService service;

    private static final Long PLAYER_ID = 42L;
    private static final ZoneId TAIPEI = ZoneId.of("Asia/Taipei");
    private static final YearMonth MONTH = YearMonth.now(TAIPEI);
    private static final String MONTH_STR = MONTH.toString(); // yyyy-MM

    // ── claim ────────────────────────────────────────────────────────────

    @Test
    void claim_reached_savesClaimAndPublishesOutboxWithCorrectPayload() {
        when(dailyCheckinRepository.countByPlayerIdAndCheckinDateBetween(eq(PLAYER_ID), any(), any()))
                .thenReturn(10L);
        when(monthlyRewardClaimRepository
                .existsByPlayerIdAndRewardMonthAndMilestoneDays(PLAYER_ID, MONTH_STR, 10))
                .thenReturn(false);

        MonthlyRewardClaimResponse result = service.claimMonthlyReward(PLAYER_ID, 10);

        assertThat(result.milestoneDays()).isEqualTo(10);
        assertThat(result.rewardAmount()).isEqualTo(2000L);
        assertThat(result.rewardMonth()).isEqualTo(MONTH_STR);

        verify(monthlyRewardClaimRepository, times(1)).save(any(MonthlyRewardClaim.class));

        ArgumentCaptor<Object> payloadCaptor = ArgumentCaptor.forClass(Object.class);
        verify(outboxService).save(eq("wallet.credit.request"), eq(String.valueOf(PLAYER_ID)), payloadCaptor.capture());

        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) payloadCaptor.getValue();
        assertThat(payload.get("amount")).isEqualTo(2000L);
        assertThat(payload.get("subType")).isEqualTo("MONTHLY_REWARD");
        assertThat(payload.get("idempotencyKey"))
                .isEqualTo("monthly-reward-" + PLAYER_ID + "-" + MONTH_STR + "-10");
    }

    @Test
    void claim_notReached_throws422AndNoOutbox() {
        when(dailyCheckinRepository.countByPlayerIdAndCheckinDateBetween(eq(PLAYER_ID), any(), any()))
                .thenReturn(5L);

        assertThatThrownBy(() -> service.claimMonthlyReward(PLAYER_ID, 10))
                .isInstanceOf(MonthlyRewardNotEligibleException.class);

        verify(monthlyRewardClaimRepository, never()).save(any());
        verify(outboxService, never()).save(any(), any(), any());
    }

    @Test
    void claim_alreadyClaimed_throws409AndNoOutbox() {
        when(dailyCheckinRepository.countByPlayerIdAndCheckinDateBetween(eq(PLAYER_ID), any(), any()))
                .thenReturn(28L);
        when(monthlyRewardClaimRepository
                .existsByPlayerIdAndRewardMonthAndMilestoneDays(PLAYER_ID, MONTH_STR, 20))
                .thenReturn(true);

        assertThatThrownBy(() -> service.claimMonthlyReward(PLAYER_ID, 20))
                .isInstanceOf(MonthlyRewardAlreadyClaimedException.class);

        verify(monthlyRewardClaimRepository, never()).save(any());
        verify(outboxService, never()).save(any(), any(), any());
    }

    @Test
    void claim_invalidMilestone_throws400AndNoRepositoryInteraction() {
        assertThatThrownBy(() -> service.claimMonthlyReward(PLAYER_ID, 15))
                .isInstanceOf(InvalidMonthlyMilestoneException.class);

        verify(dailyCheckinRepository, never()).countByPlayerIdAndCheckinDateBetween(any(), any(), any());
        verify(monthlyRewardClaimRepository, never()).save(any());
        verify(outboxService, never()).save(any(), any(), any());
    }

    // ── status ───────────────────────────────────────────────────────────

    @Test
    void getStatus_currentMonth_flagsReachedAndClaimedCorrectly() {
        // 當月簽到 10 天
        List<DailyCheckin> signed = new ArrayList<>();
        for (int day = 1; day <= 10; day++) {
            signed.add(buildCheckin(MONTH.atDay(day), day));
        }
        when(dailyCheckinRepository.findByPlayerIdAndCheckinDateBetween(eq(PLAYER_ID), any(), any()))
                .thenReturn(signed);

        LocalDate today = LocalDate.now(TAIPEI);
        when(dailyCheckinRepository.findTopByPlayerIdOrderByCheckinDateDesc(PLAYER_ID))
                .thenReturn(Optional.of(buildCheckin(today, 10)));

        // 里程碑 10 已領
        MonthlyRewardClaim claimed10 = new MonthlyRewardClaim();
        claimed10.setPlayerId(PLAYER_ID);
        claimed10.setRewardMonth(MONTH_STR);
        claimed10.setMilestoneDays(10);
        claimed10.setRewardAmount(2000L);
        when(monthlyRewardClaimRepository.findByPlayerIdAndRewardMonth(PLAYER_ID, MONTH_STR))
                .thenReturn(List.of(claimed10));

        CheckinStatusResponse status = service.getStatus(PLAYER_ID, null);

        assertThat(status.month()).isEqualTo(MONTH_STR);
        assertThat(status.monthCheckinDays()).isEqualTo(10);
        assertThat(status.checkedInToday()).isTrue();
        assertThat(status.consecutiveDays()).isEqualTo(10);

        Map<Integer, MonthlyMilestoneStatus> byDays = new java.util.HashMap<>();
        status.milestones().forEach(m -> byDays.put(m.milestoneDays(), m));

        // 10 天：達標 + 已領 → 不可再領
        assertThat(byDays.get(10).reached()).isTrue();
        assertThat(byDays.get(10).claimed()).isTrue();
        assertThat(byDays.get(10).claimable()).isFalse();
        // 20 天：未達標
        assertThat(byDays.get(20).reached()).isFalse();
        assertThat(byDays.get(20).claimable()).isFalse();
    }

    @Test
    void getStatus_reachedButNotClaimed_isClaimableInCurrentMonth() {
        List<DailyCheckin> signed = new ArrayList<>();
        for (int day = 1; day <= 10; day++) {
            signed.add(buildCheckin(MONTH.atDay(day), day));
        }
        when(dailyCheckinRepository.findByPlayerIdAndCheckinDateBetween(eq(PLAYER_ID), any(), any()))
                .thenReturn(signed);
        when(dailyCheckinRepository.findTopByPlayerIdOrderByCheckinDateDesc(PLAYER_ID))
                .thenReturn(Optional.of(buildCheckin(LocalDate.now(TAIPEI), 10)));
        when(monthlyRewardClaimRepository.findByPlayerIdAndRewardMonth(PLAYER_ID, MONTH_STR))
                .thenReturn(List.of());

        CheckinStatusResponse status = service.getStatus(PLAYER_ID, null);

        MonthlyMilestoneStatus ms10 = status.milestones().stream()
                .filter(m -> m.milestoneDays() == 10).findFirst().orElseThrow();
        assertThat(ms10.reached()).isTrue();
        assertThat(ms10.claimed()).isFalse();
        assertThat(ms10.claimable()).isTrue();
    }

    private DailyCheckin buildCheckin(LocalDate date, int consecutiveDays) {
        DailyCheckin c = new DailyCheckin();
        c.setPlayerId(PLAYER_ID);
        c.setCheckinDate(date);
        c.setConsecutiveDays(consecutiveDays);
        return c;
    }
}
