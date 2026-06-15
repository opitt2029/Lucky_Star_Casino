package com.luckystar.admin.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.luckystar.admin.dto.CoinFlowReport;
import com.luckystar.admin.dto.ReportDimension;
import com.luckystar.admin.dto.RtpReport;
import com.luckystar.admin.service.CoinFlowReportService;
import com.luckystar.admin.service.RtpReportService;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class AdminReportControllerTest {

    @Mock CoinFlowReportService coinFlowReportService;
    @Mock RtpReportService rtpReportService;

    MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
                .standaloneSetup(new AdminReportController(coinFlowReportService, rtpReportService))
                .setControllerAdvice(new AdminExceptionHandler())
                .build();
    }

    @Test
    void coinFlow_returnsReport() throws Exception {
        when(coinFlowReportService.getCoinFlow(eq(ReportDimension.DAY), any(), any())).thenReturn(
                new CoinFlowReport("DAY", LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 2),
                        1500, 500, 1000,
                        List.of(new CoinFlowReport.Point("2026-06-01", 1500, 500, 1000))));

        mockMvc.perform(get("/admin/reports/coin-flow?dimension=day&from=2026-06-01&to=2026-06-02"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalNet").value(1000))
                .andExpect(jsonPath("$.points[0].bucket").value("2026-06-01"));
    }

    @Test
    void coinFlow_invalidDimension_returns400() throws Exception {
        mockMvc.perform(get("/admin/reports/coin-flow?dimension=hour&from=2026-06-01&to=2026-06-02"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void rtp_returnsReport() throws Exception {
        when(rtpReportService.getRtpReport(any(), any(), any())).thenReturn(
                new RtpReport(LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 1), 0.05,
                        List.of(new RtpReport.Item("SLOT", 0.95, 0.89, 100, 89, 10, -0.06, "ABNORMAL"))));

        mockMvc.perform(get("/admin/reports/rtp?from=2026-06-01&to=2026-06-01"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].gameType").value("SLOT"))
                .andExpect(jsonPath("$.items[0].status").value("ABNORMAL"));
    }
}
