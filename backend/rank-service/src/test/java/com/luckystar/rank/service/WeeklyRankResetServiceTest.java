package com.luckystar.rank.service;

import com.luckystar.rank.dto.PlayerCoinBalance;
import com.luckystar.rank.dto.RankEntryResponse;
import com.luckystar.rank.entity.RankHistory;
import com.luckystar.rank.kafka.NotificationPushPublisher;
import com.luckystar.rank.repository.RankHistoryRepository;
import com.luckystar.rank.repository.WalletBalanceReadRepository;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WeeklyRankResetServiceTest {

    @Mock
    RankService rankService;

    @Mock
    RankHistoryRepository rankHistoryRepository;

    @Mock
    WalletBalanceReadRepository walletBalanceReadRepository;

    @Mock
    NotificationPushPublisher notificationPushPublisher;

    @Test
    void resetWeeklyRank_snapshotsChampionNotifiesTop3AndClearsGlobalRank() {
        WeeklyRankResetService service = buildService();
        List<RankEntryResponse> top3 = List.of(
                new RankEntryResponse(7L, "nova", 1L, 9000L),
                new RankEntryResponse(42L, "alice", 2L, 1500L),
                new RankEntryResponse(9L, "mika", 3L, 1000L));
        LocalDate executionDate = LocalDate.of(2026, 6, 15);
        LocalDate previousWeekStart = LocalDate.of(2026, 6, 8);

        when(rankService.getTopGlobalCoins(3)).thenReturn(top3);
        when(rankHistoryRepository.existsByWeekStartAndRank(previousWeekStart, 1)).thenReturn(false);
        when(walletBalanceReadRepository.findAllWalletBalances()).thenReturn(List.of(
                new PlayerCoinBalance(7L, 9000L),
                new PlayerCoinBalance(42L, 1500L),
                new PlayerCoinBalance(9L, 1000L)));
        when(rankService.rebuildGlobalCoinsRank(any())).thenReturn(3);
        when(notificationPushPublisher.publishWeeklyTop3Notification(any(), eq(previousWeekStart), eq(top3)))
                .thenReturn(true);

        WeeklyRankResetService.WeeklyRankResetResult result = service.resetWeeklyRank(executionDate);

        ArgumentCaptor<RankHistory> historyCaptor = ArgumentCaptor.forClass(RankHistory.class);
        verify(rankHistoryRepository).save(historyCaptor.capture());
        RankHistory history = historyCaptor.getValue();
        assertThat(history.getPlayerId()).isEqualTo(7L);
        assertThat(history.getNickname()).isEqualTo("nova");
        assertThat(history.getBalance()).isEqualTo(9000L);
        assertThat(history.getRank()).isEqualTo(1);
        assertThat(history.getWeekStart()).isEqualTo(previousWeekStart);

        verify(notificationPushPublisher).publishWeeklyTop3Notification(top3.get(0), previousWeekStart, top3);
        verify(notificationPushPublisher).publishWeeklyTop3Notification(top3.get(1), previousWeekStart, top3);
        verify(notificationPushPublisher).publishWeeklyTop3Notification(top3.get(2), previousWeekStart, top3);
        verify(rankService).rebuildGlobalCoinsRank(List.of(
                new PlayerCoinBalance(7L, 9000L),
                new PlayerCoinBalance(42L, 1500L),
                new PlayerCoinBalance(9L, 1000L)));
        assertThat(result).isEqualTo(new WeeklyRankResetService.WeeklyRankResetResult(
                previousWeekStart,
                3,
                true,
                3,
                3));
    }

    @Test
    void resetWeeklyRank_whenNoRankedPlayersOnlyClearsGlobalRank() {
        WeeklyRankResetService service = buildService();
        when(rankService.getTopGlobalCoins(3)).thenReturn(List.of());
        when(walletBalanceReadRepository.findAllWalletBalances()).thenReturn(List.of());
        when(rankService.rebuildGlobalCoinsRank(List.of())).thenReturn(0);

        WeeklyRankResetService.WeeklyRankResetResult result = service.resetWeeklyRank(LocalDate.of(2026, 6, 15));

        verify(rankHistoryRepository, never()).existsByWeekStartAndRank(any(), any());
        verify(rankHistoryRepository, never()).save(any());
        verify(notificationPushPublisher, never()).publishWeeklyTop3Notification(any(), any(), any());
        verify(rankService).rebuildGlobalCoinsRank(List.of());
        assertThat(result).isEqualTo(new WeeklyRankResetService.WeeklyRankResetResult(
                LocalDate.of(2026, 6, 8),
                0,
                false,
                0,
                0));
    }

    @Test
    void resetWeeklyRank_whenChampionSnapshotAlreadyExistsDoesNotDuplicateHistory() {
        WeeklyRankResetService service = buildService();
        List<RankEntryResponse> top3 = List.of(new RankEntryResponse(7L, "nova", 1L, 9000L));
        LocalDate weekStart = LocalDate.of(2026, 6, 8);

        when(rankService.getTopGlobalCoins(3)).thenReturn(top3);
        when(rankHistoryRepository.existsByWeekStartAndRank(weekStart, 1)).thenReturn(true);
        when(walletBalanceReadRepository.findAllWalletBalances()).thenReturn(List.of(new PlayerCoinBalance(7L, 9000L)));
        when(rankService.rebuildGlobalCoinsRank(List.of(new PlayerCoinBalance(7L, 9000L)))).thenReturn(1);
        when(notificationPushPublisher.publishWeeklyTop3Notification(top3.get(0), weekStart, top3))
                .thenReturn(true);

        WeeklyRankResetService.WeeklyRankResetResult result = service.resetWeeklyRank(LocalDate.of(2026, 6, 15));

        verify(rankHistoryRepository, never()).save(any());
        verify(rankService).rebuildGlobalCoinsRank(List.of(new PlayerCoinBalance(7L, 9000L)));
        assertThat(result).isEqualTo(new WeeklyRankResetService.WeeklyRankResetResult(
                weekStart,
                1,
                false,
                1,
                1));
    }

    @Test
    void resetWeeklyRank_savesHistoryBeforeRebuildAndNotifications() {
        WeeklyRankResetService service = buildService();
        List<RankEntryResponse> top3 = List.of(new RankEntryResponse(7L, "nova", 1L, 9000L));
        LocalDate weekStart = LocalDate.of(2026, 6, 8);

        when(rankService.getTopGlobalCoins(3)).thenReturn(top3);
        when(rankHistoryRepository.existsByWeekStartAndRank(weekStart, 1)).thenReturn(false);
        when(walletBalanceReadRepository.findAllWalletBalances()).thenReturn(List.of(new PlayerCoinBalance(7L, 9000L)));
        when(rankService.rebuildGlobalCoinsRank(List.of(new PlayerCoinBalance(7L, 9000L)))).thenReturn(1);
        when(notificationPushPublisher.publishWeeklyTop3Notification(top3.get(0), weekStart, top3))
                .thenReturn(true);

        service.resetWeeklyRank(LocalDate.of(2026, 6, 15));

        InOrder inOrder = inOrder(rankHistoryRepository, walletBalanceReadRepository, rankService, notificationPushPublisher);
        inOrder.verify(rankHistoryRepository).save(any());
        inOrder.verify(walletBalanceReadRepository).findAllWalletBalances();
        inOrder.verify(rankService).rebuildGlobalCoinsRank(List.of(new PlayerCoinBalance(7L, 9000L)));
        inOrder.verify(notificationPushPublisher).publishWeeklyTop3Notification(top3.get(0), weekStart, top3);
    }

    private WeeklyRankResetService buildService() {
        return new WeeklyRankResetService(
                rankService,
                rankHistoryRepository,
                walletBalanceReadRepository,
                notificationPushPublisher);
    }
}
