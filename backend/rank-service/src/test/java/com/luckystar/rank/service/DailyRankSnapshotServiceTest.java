package com.luckystar.rank.service;

import com.luckystar.rank.dto.PlayerCoinBalance;
import com.luckystar.rank.entity.RankDailySnapshot;
import com.luckystar.rank.repository.RankDailySnapshotRepository;
import com.luckystar.rank.repository.WalletBalanceReadRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.groups.Tuple.tuple;
import static org.mockito.ArgumentMatchers.anyIterable;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DailyRankSnapshotServiceTest {

    @Mock
    WalletBalanceReadRepository walletBalanceReadRepository;

    @Mock
    RankDailySnapshotRepository rankDailySnapshotRepository;

    @Test
    void snapshotDailyBalances_savesPreviousDayWalletBalances() {
        DailyRankSnapshotService service = buildService();
        LocalDate executionDate = LocalDate.of(2026, 6, 13);
        LocalDate snapshotDate = LocalDate.of(2026, 6, 12);
        when(walletBalanceReadRepository.findAllWalletBalances()).thenReturn(List.of(
                new PlayerCoinBalance(7L, 9000L),
                new PlayerCoinBalance(42L, 1500L),
                new PlayerCoinBalance(9L, 1000L)));
        when(rankDailySnapshotRepository.findPlayerIdsBySnapshotDate(snapshotDate)).thenReturn(Set.of());

        DailyRankSnapshotService.DailyRankSnapshotResult result = service.snapshotDailyBalances(executionDate);

        ArgumentCaptor<Iterable<RankDailySnapshot>> snapshotsCaptor = ArgumentCaptor.forClass(Iterable.class);
        verify(rankDailySnapshotRepository).saveAll(snapshotsCaptor.capture());
        assertThat(snapshotsCaptor.getValue())
                .extracting(
                        RankDailySnapshot::getPlayerId,
                        RankDailySnapshot::getBalance,
                        RankDailySnapshot::getSnapshotDate)
                .containsExactlyInAnyOrder(
                        tuple(7L, 9000L, snapshotDate),
                        tuple(42L, 1500L, snapshotDate),
                        tuple(9L, 1000L, snapshotDate));
        assertThat(result).isEqualTo(new DailyRankSnapshotService.DailyRankSnapshotResult(
                snapshotDate,
                3,
                0,
                3));
    }

    @Test
    void snapshotDailyBalances_skipsAlreadySnapshottedPlayers() {
        DailyRankSnapshotService service = buildService();
        LocalDate executionDate = LocalDate.of(2026, 6, 13);
        LocalDate snapshotDate = LocalDate.of(2026, 6, 12);
        when(walletBalanceReadRepository.findAllWalletBalances()).thenReturn(List.of(
                new PlayerCoinBalance(7L, 9000L),
                new PlayerCoinBalance(42L, 1500L)));
        when(rankDailySnapshotRepository.findPlayerIdsBySnapshotDate(snapshotDate)).thenReturn(Set.of(7L));

        DailyRankSnapshotService.DailyRankSnapshotResult result = service.snapshotDailyBalances(executionDate);

        ArgumentCaptor<Iterable<RankDailySnapshot>> snapshotsCaptor = ArgumentCaptor.forClass(Iterable.class);
        verify(rankDailySnapshotRepository).saveAll(snapshotsCaptor.capture());
        assertThat(snapshotsCaptor.getValue())
                .extracting(RankDailySnapshot::getPlayerId)
                .containsExactly(42L);
        assertThat(result).isEqualTo(new DailyRankSnapshotService.DailyRankSnapshotResult(
                snapshotDate,
                2,
                1,
                1));
    }

    @Test
    void snapshotDailyBalances_whenNoNewSnapshotsDoesNotSave() {
        DailyRankSnapshotService service = buildService();
        LocalDate executionDate = LocalDate.of(2026, 6, 13);
        LocalDate snapshotDate = LocalDate.of(2026, 6, 12);
        when(walletBalanceReadRepository.findAllWalletBalances()).thenReturn(List.of(
                new PlayerCoinBalance(7L, 9000L)));
        when(rankDailySnapshotRepository.findPlayerIdsBySnapshotDate(snapshotDate)).thenReturn(Set.of(7L));

        DailyRankSnapshotService.DailyRankSnapshotResult result = service.snapshotDailyBalances(executionDate);

        verify(rankDailySnapshotRepository, never()).saveAll(anyIterable());
        assertThat(result).isEqualTo(new DailyRankSnapshotService.DailyRankSnapshotResult(
                snapshotDate,
                1,
                1,
                0));
    }

    @Test
    void snapshotDailyBalances_filtersInvalidWalletRows() {
        DailyRankSnapshotService service = buildService();
        LocalDate executionDate = LocalDate.of(2026, 6, 13);
        LocalDate snapshotDate = LocalDate.of(2026, 6, 12);
        when(walletBalanceReadRepository.findAllWalletBalances()).thenReturn(List.of(
                new PlayerCoinBalance(null, 9000L),
                new PlayerCoinBalance(42L, null),
                new PlayerCoinBalance(9L, -1L)));
        when(rankDailySnapshotRepository.findPlayerIdsBySnapshotDate(snapshotDate)).thenReturn(Set.of());

        DailyRankSnapshotService.DailyRankSnapshotResult result = service.snapshotDailyBalances(executionDate);

        verify(rankDailySnapshotRepository, never()).saveAll(anyIterable());
        assertThat(result).isEqualTo(new DailyRankSnapshotService.DailyRankSnapshotResult(
                snapshotDate,
                3,
                0,
                0));
    }

    private DailyRankSnapshotService buildService() {
        return new DailyRankSnapshotService(walletBalanceReadRepository, rankDailySnapshotRepository);
    }
}
