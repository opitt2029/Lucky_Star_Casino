package com.luckystar.admin.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * 星幣流通量報表（T-052）。
 * issued=發放（CREDIT/BONUS：簽到/任務/派彩/GM/補助）；consumed=消耗（DEBIT：下注）；net=淨流通。
 */
public record CoinFlowReport(
        String dimension,
        LocalDate from,
        LocalDate to,
        long totalIssued,
        long totalConsumed,
        long totalNet,
        List<Point> points
) {

    /** 單一時間桶。 */
    public record Point(
            String bucket,
            long issued,
            long consumed,
            long net
    ) {}
}
