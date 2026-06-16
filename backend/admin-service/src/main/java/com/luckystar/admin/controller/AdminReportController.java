package com.luckystar.admin.controller;

import com.luckystar.admin.dto.CoinFlowReport;
import com.luckystar.admin.dto.ReportDimension;
import com.luckystar.admin.dto.RtpReport;
import com.luckystar.admin.service.CoinFlowReportService;
import com.luckystar.admin.service.RtpReportService;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 後台報表 API（T-052 星幣流通量、T-053 RTP 監控）。{@code /admin/**} 需 ROLE_ADMIN。
 */
@RestController
@RequestMapping("/admin/reports")
public class AdminReportController {

    private final CoinFlowReportService coinFlowReportService;
    private final RtpReportService rtpReportService;

    public AdminReportController(CoinFlowReportService coinFlowReportService,
                                 RtpReportService rtpReportService) {
        this.coinFlowReportService = coinFlowReportService;
        this.rtpReportService = rtpReportService;
    }

    /** T-052：星幣流通量（發放 vs 消耗 vs 淨流通）依日/週/月維度。 */
    @GetMapping("/coin-flow")
    public CoinFlowReport coinFlow(
            @RequestParam(defaultValue = "day") String dimension,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return coinFlowReportService.getCoinFlow(ReportDimension.from(dimension), from, to);
    }

    /** T-053：RTP 監控，實際 vs 設計，偏差 >5% 標 ABNORMAL。 */
    @GetMapping("/rtp")
    public RtpReport rtp(
            @RequestParam(required = false) String game,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return rtpReportService.getRtpReport(game, from, to);
    }
}
