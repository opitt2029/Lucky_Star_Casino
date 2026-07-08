package com.luckystar.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.luckystar.admin.dto.RtpReport;
import com.luckystar.admin.postgres.entity.GameRtpStatRead;
import com.luckystar.admin.postgres.repository.GameRtpStatReadRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class RtpReportServiceTest {

    @Mock
    GameRtpStatReadRepository rtpStatRepository;

    RtpReportService service;

    @BeforeEach
    void setUp() {
        // design slot=0.95, baccarat=0.98, fishing=0.96, threshold=0.05
        service = new RtpReportService(rtpStatRepository, 0.95, 0.98, 0.96, 0.05);
    }

    private GameRtpStatRead stat(String game, long bet, long win) {
        GameRtpStatRead s = new GameRtpStatRead();
        ReflectionTestUtils.setField(s, "gameType", game);
        ReflectionTestUtils.setField(s, "totalBet", bet);
        ReflectionTestUtils.setField(s, "totalWin", win);
        ReflectionTestUtils.setField(s, "roundCount", 10);
        ReflectionTestUtils.setField(s, "calculatedAt", LocalDateTime.of(2026, 6, 1, 0, 0));
        return s;
    }

    @Test
    void deviationExactlyAtThreshold_isNormal() {
        // SLOT 設計 0.95，實際 0.90 → 偏差 -0.05（剛好門檻）→ NORMAL
        when(rtpStatRepository.findByCalculatedAtBetween(any(), any()))
                .thenReturn(List.of(stat("SLOT", 100, 90)));

        RtpReport report = service.getRtpReport(null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 1));

        RtpReport.Item slot = report.items().get(0);
        assertThat(slot.actualRtp()).isEqualTo(0.9);
        assertThat(slot.status()).isEqualTo(RtpReportService.STATUS_NORMAL);
    }

    @Test
    void deviationBeyondThreshold_isAbnormal() {
        // SLOT 設計 0.95，實際 0.89 → 偏差 -0.06（>5%）→ ABNORMAL
        when(rtpStatRepository.findByCalculatedAtBetween(any(), any()))
                .thenReturn(List.of(stat("SLOT", 100, 89)));

        RtpReport report = service.getRtpReport(null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 1));

        assertThat(report.items().get(0).status()).isEqualTo(RtpReportService.STATUS_ABNORMAL);
    }

    @Test
    void aggregatesMultipleStatsPerGameType() {
        when(rtpStatRepository.findByCalculatedAtBetween(any(), any())).thenReturn(List.of(
                stat("BACCARAT", 100, 98),
                stat("BACCARAT", 100, 98)));

        RtpReport report = service.getRtpReport(null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 1));

        RtpReport.Item baccarat = report.items().get(0);
        assertThat(baccarat.totalBet()).isEqualTo(200);
        assertThat(baccarat.totalWin()).isEqualTo(196);
        assertThat(baccarat.actualRtp()).isEqualTo(0.98);
        assertThat(baccarat.status()).isEqualTo(RtpReportService.STATUS_NORMAL);
    }

    @Test
    void fishing_actualNearDesignRtp_isNormal() {
        // FISHING 設計 0.96，實際 0.97 → 偏差 0.01（<5%）→ NORMAL（回歸：曾因無 FISHING 設計值而永遠判 ABNORMAL）
        when(rtpStatRepository.findByCalculatedAtBetween(any(), any()))
                .thenReturn(List.of(stat("FISHING", 100, 97)));

        RtpReport report = service.getRtpReport(null, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 1));

        RtpReport.Item fishing = report.items().get(0);
        assertThat(fishing.designRtp()).isEqualTo(0.96);
        assertThat(fishing.status()).isEqualTo(RtpReportService.STATUS_NORMAL);
    }

    @Test
    void gameFilter_usesGameTypeQuery() {
        when(rtpStatRepository.findByGameTypeAndCalculatedAtBetween(eq("SLOT"), any(), any()))
                .thenReturn(List.of(stat("SLOT", 100, 95)));

        RtpReport report = service.getRtpReport("slot", LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 1));

        assertThat(report.items()).hasSize(1);
        verify(rtpStatRepository).findByGameTypeAndCalculatedAtBetween(eq("SLOT"), any(), any());
    }
}
