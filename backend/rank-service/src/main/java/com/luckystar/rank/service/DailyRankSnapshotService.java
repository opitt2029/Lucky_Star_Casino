package com.luckystar.rank.service;

import com.luckystar.rank.dto.PlayerCoinBalance;
import com.luckystar.rank.entity.RankDailySnapshot;
import com.luckystar.rank.repository.RankDailySnapshotRepository;
import com.luckystar.rank.repository.WalletBalanceReadRepository;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DailyRankSnapshotService {

    static final ZoneId TAIPEI_ZONE = ZoneId.of("Asia/Taipei");

    private final WalletBalanceReadRepository walletBalanceReadRepository;
    private final RankDailySnapshotRepository rankDailySnapshotRepository;

    public DailyRankSnapshotService(
            WalletBalanceReadRepository walletBalanceReadRepository,
            RankDailySnapshotRepository rankDailySnapshotRepository) {
        this.walletBalanceReadRepository = walletBalanceReadRepository;
        this.rankDailySnapshotRepository = rankDailySnapshotRepository;
    }

    @Transactional
    public DailyRankSnapshotResult snapshotDailyBalances() {
        return snapshotDailyBalances(LocalDate.now(TAIPEI_ZONE));
    }

    @Transactional
    public DailyRankSnapshotResult snapshotDailyBalances(LocalDate executionDate) {
        Objects.requireNonNull(executionDate, "executionDate is required");
        LocalDate snapshotDate = executionDate.minusDays(1);
        List<PlayerCoinBalance> balances = walletBalanceReadRepository.findAllWalletBalances();
        Set<Long> existingPlayerIds = rankDailySnapshotRepository.findPlayerIdsBySnapshotDate(snapshotDate);

        List<RankDailySnapshot> snapshots = balances.stream()
                .filter(Objects::nonNull)
                .filter(balance -> balance.playerId() != null)
                .filter(balance -> balance.balance() != null && balance.balance() >= 0)
                .filter(balance -> !existingPlayerIds.contains(balance.playerId()))
                .map(balance -> new RankDailySnapshot(balance.playerId(), balance.balance(), snapshotDate))
                .toList();

        if (!snapshots.isEmpty()) {
            rankDailySnapshotRepository.saveAll(snapshots);
        }

        return new DailyRankSnapshotResult(snapshotDate, balances.size(), existingPlayerIds.size(), snapshots.size());
    }

    public record DailyRankSnapshotResult(
            LocalDate snapshotDate,
            int walletCount,
            int alreadySnapshotted,
            int createdSnapshots) {
    }
}
