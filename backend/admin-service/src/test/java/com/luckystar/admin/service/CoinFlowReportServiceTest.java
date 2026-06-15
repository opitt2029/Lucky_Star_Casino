package com.luckystar.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.luckystar.admin.dto.CoinFlowReport;
import com.luckystar.admin.dto.ReportDimension;
import com.luckystar.admin.mysql.entity.WalletTransactionRead;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class CoinFlowReportServiceTest {

    @Mock
    com.luckystar.admin.mysql.repository.WalletTransactionReadRepository transactionRepository;

    private WalletTransactionRead tx(String type, long amount, LocalDateTime when) {
        WalletTransactionRead t = new WalletTransactionRead();
        ReflectionTestUtils.setField(t, "type", type);
        ReflectionTestUtils.setField(t, "amount", amount);
        ReflectionTestUtils.setField(t, "createdAt", when);
        return t;
    }

    @Test
    void coinFlow_byDay_aggregatesIssuedConsumedAndNet() {
        when(transactionRepository.findByCreatedAtBetween(any(), any())).thenReturn(List.of(
                tx("CREDIT", 1000, LocalDateTime.of(2026, 6, 1, 9, 0)),   // 發放
                tx("BONUS", 500, LocalDateTime.of(2026, 6, 1, 10, 0)),    // 發放
                tx("DEBIT", 300, LocalDateTime.of(2026, 6, 1, 11, 0)),    // 消耗
                tx("DEBIT", 200, LocalDateTime.of(2026, 6, 2, 11, 0))));  // 次日消耗
        CoinFlowReportService service = new CoinFlowReportService(transactionRepository);

        CoinFlowReport report = service.getCoinFlow(
                ReportDimension.DAY, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 2));

        assertThat(report.totalIssued()).isEqualTo(1500);
        assertThat(report.totalConsumed()).isEqualTo(500);
        assertThat(report.totalNet()).isEqualTo(1000);
        assertThat(report.points()).hasSize(2);
        assertThat(report.points().get(0)).isEqualTo(
                new CoinFlowReport.Point("2026-06-01", 1500, 300, 1200));
        assertThat(report.points().get(1)).isEqualTo(
                new CoinFlowReport.Point("2026-06-02", 0, 200, -200));
    }

    @Test
    void coinFlow_byMonth_bucketsByYearMonth() {
        when(transactionRepository.findByCreatedAtBetween(any(), any())).thenReturn(List.of(
                tx("CREDIT", 100, LocalDateTime.of(2026, 5, 31, 9, 0)),
                tx("CREDIT", 400, LocalDateTime.of(2026, 6, 15, 9, 0)),
                tx("DEBIT", 50, LocalDateTime.of(2026, 6, 20, 9, 0))));
        CoinFlowReportService service = new CoinFlowReportService(transactionRepository);

        CoinFlowReport report = service.getCoinFlow(
                ReportDimension.MONTH, LocalDate.of(2026, 5, 1), LocalDate.of(2026, 6, 30));

        assertThat(report.points()).containsExactly(
                new CoinFlowReport.Point("2026-05", 100, 0, 100),
                new CoinFlowReport.Point("2026-06", 400, 50, 350));
    }
}
