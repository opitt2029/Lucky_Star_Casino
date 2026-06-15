package com.luckystar.game.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.luckystar.game.entity.GameRtpStat;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.repository.GameRtpStatRepository;
import com.luckystar.game.dto.RtpStatView;
import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** {@link RtpStatsService} 單元測試（純 Mockito）。 */
class RtpStatsServiceTest {

    private final GameRoundRepository roundRepository = org.mockito.Mockito.mock(GameRoundRepository.class);
    private final GameRtpStatRepository rtpStatRepository = org.mockito.Mockito.mock(GameRtpStatRepository.class);

    private RtpStatsService service;

    @BeforeEach
    void setUp() {
        service = new RtpStatsService(roundRepository, rtpStatRepository);
        when(rtpStatRepository.save(any(GameRtpStat.class)))
                .thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    @DisplayName("computeRtp：1760/10000=0.176；無下注=0")
    void computeRtp() {
        assertEquals(0.176d, RtpStatsService.computeRtp(10000L, 1760L));
        assertEquals(0.0d, RtpStatsService.computeRtp(0L, 0L));
    }

    @Test
    @DisplayName("recalculate：彙總近一萬局，寫入 total_bet/total_win/round_count")
    void recalculate_buildsStat() {
        when(roundRepository.aggregateRecent("SLOT", 10000))
                .thenReturn(Collections.singletonList(new Object[] {10000L, 1760L, 100L}));

        service.recalculate("SLOT");

        ArgumentCaptor<GameRtpStat> cap = ArgumentCaptor.forClass(GameRtpStat.class);
        verify(rtpStatRepository).save(cap.capture());
        GameRtpStat s = cap.getValue();
        assertEquals("SLOT", s.getGameType());
        assertEquals(10000L, s.getTotalBet());
        assertEquals(1760L, s.getTotalWin());
        assertEquals(100, s.getRoundCount());
    }

    @Test
    @DisplayName("recalculate：無資料（空彙總）→ 寫入零值，不丟例外")
    void recalculate_emptyAggregate_writesZeros() {
        when(roundRepository.aggregateRecent("BACCARAT", 10000)).thenReturn(List.of());

        service.recalculate("BACCARAT");

        ArgumentCaptor<GameRtpStat> cap = ArgumentCaptor.forClass(GameRtpStat.class);
        verify(rtpStatRepository).save(cap.capture());
        assertEquals(0L, cap.getValue().getTotalBet());
        assertEquals(0, cap.getValue().getRoundCount());
    }

    @Test
    @DisplayName("recalculateAll：SLOT、BACCARAT、FISHING 各寫一筆")
    void recalculateAll_allGames() {
        when(roundRepository.aggregateRecent(eq("SLOT"), eq(10000)))
                .thenReturn(Collections.singletonList(new Object[] {500L, 90L, 5L}));
        when(roundRepository.aggregateRecent(eq("BACCARAT"), eq(10000)))
                .thenReturn(Collections.singletonList(new Object[] {300L, 285L, 3L}));
        when(roundRepository.aggregateRecent(eq("FISHING"), eq(10000)))
                .thenReturn(Collections.singletonList(new Object[] {2000L, 1840L, 2L}));

        List<GameRtpStat> saved = service.recalculateAll();

        assertEquals(3, saved.size());
        verify(rtpStatRepository, times(3)).save(any(GameRtpStat.class));
    }

    @Test
    @DisplayName("latestStats：取各遊戲最新一筆並算 RTP；無資料的遊戲略過")
    void latestStats_mapsAndComputesRtp() {
        GameRtpStat slot = new GameRtpStat();
        slot.setGameType("SLOT");
        slot.setTotalBet(10000L);
        slot.setTotalWin(1760L);
        slot.setRoundCount(100);
        slot.setCalculatedAt(LocalDateTime.now());
        when(rtpStatRepository.findTopByGameTypeOrderByCalculatedAtDesc("SLOT"))
                .thenReturn(Optional.of(slot));
        when(rtpStatRepository.findTopByGameTypeOrderByCalculatedAtDesc("BACCARAT"))
                .thenReturn(Optional.empty());

        List<RtpStatView> views = service.latestStats();

        assertEquals(1, views.size(), "BACCARAT 無資料應略過");
        assertEquals("SLOT", views.get(0).getGameType());
        assertEquals(0.176d, views.get(0).getRtp());
    }
}
