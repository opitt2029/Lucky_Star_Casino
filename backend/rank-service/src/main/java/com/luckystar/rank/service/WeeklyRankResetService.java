package com.luckystar.rank.service;

import com.luckystar.rank.dto.RankEntryResponse;
import com.luckystar.rank.entity.RankHistory;
import com.luckystar.rank.kafka.NotificationPushPublisher;
import com.luckystar.rank.repository.RankHistoryRepository;
import com.luckystar.rank.repository.WalletBalanceReadRepository;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WeeklyRankResetService {

    static final ZoneId TAIPEI_ZONE = ZoneId.of("Asia/Taipei");
    private static final int TOP3_LIMIT = 3;
    private static final int CHAMPION_RANK = 1;

    private final RankService rankService;
    private final RankHistoryRepository rankHistoryRepository;
    private final WalletBalanceReadRepository walletBalanceReadRepository;
    private final NotificationPushPublisher notificationPushPublisher;

    public WeeklyRankResetService(
            RankService rankService,
            RankHistoryRepository rankHistoryRepository,
            WalletBalanceReadRepository walletBalanceReadRepository,
            NotificationPushPublisher notificationPushPublisher) {
        this.rankService = rankService;
        this.rankHistoryRepository = rankHistoryRepository;
        this.walletBalanceReadRepository = walletBalanceReadRepository;
        this.notificationPushPublisher = notificationPushPublisher;
    }

    @Transactional
    public WeeklyRankResetResult resetWeeklyRank() {
        return resetWeeklyRank(LocalDate.now(TAIPEI_ZONE));
    }

    @Transactional
    public WeeklyRankResetResult resetWeeklyRank(LocalDate executionDate) {
        LocalDate weekStart = previousWeekStart(executionDate);
        List<RankEntryResponse> top3 = rankService.getTopGlobalCoins(TOP3_LIMIT);

        boolean snapshotCreated = false;
        if (!top3.isEmpty() && !rankHistoryRepository.existsByWeekStartAndRank(weekStart, CHAMPION_RANK)) {
            RankEntryResponse champion = top3.get(0);
            rankHistoryRepository.save(new RankHistory(
                    champion.playerId(),
                    champion.username(),
                    champion.score(),
                    CHAMPION_RANK,
                    weekStart));
            snapshotCreated = true;
        }

        int rebuiltPlayers = rankService.rebuildGlobalCoinsRank(walletBalanceReadRepository.findAllWalletBalances());

        int notificationsPublished = 0;
        for (RankEntryResponse entry : top3) {
            if (notificationPushPublisher.publishWeeklyTop3Notification(entry, weekStart, top3)) {
                notificationsPublished++;
            }
        }

        return new WeeklyRankResetResult(weekStart, top3.size(), snapshotCreated, rebuiltPlayers, notificationsPublished);
    }

    private LocalDate previousWeekStart(LocalDate executionDate) {
        return executionDate.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).minusWeeks(1);
    }

    public record WeeklyRankResetResult(
            LocalDate weekStart,
            int rankedPlayers,
            boolean snapshotCreated,
            int rebuiltPlayers,
            int notificationsPublished) {
    }
}
