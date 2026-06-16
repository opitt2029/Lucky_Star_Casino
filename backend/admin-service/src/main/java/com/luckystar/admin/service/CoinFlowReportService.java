package com.luckystar.admin.service;

import com.luckystar.admin.dto.CoinFlowReport;
import com.luckystar.admin.dto.ReportDimension;
import com.luckystar.admin.mysql.entity.WalletTransactionRead;
import com.luckystar.admin.mysql.repository.WalletTransactionReadRepository;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.stereotype.Service;

/**
 * 星幣流通量報表（T-052）。
 *
 * 讀 MySQL {@code wallet_transactions} 區間流水，於記憶體依時間維度彙整（DB 方言差異大、
 * 改 Java 彙整保證 MySQL/H2 一致且易測）。發放/消耗以 {@code type} 分類：
 * DEBIT=消耗（唯一 sub_type 為 BET），CREDIT/BONUS=發放（WIN/CHECKIN/TASK/GIFT/GM_REWARD/BANKRUPTCY_AID）。
 */
@Service
public class CoinFlowReportService {

    private final WalletTransactionReadRepository transactionRepository;

    public CoinFlowReportService(WalletTransactionReadRepository transactionRepository) {
        this.transactionRepository = transactionRepository;
    }

    public CoinFlowReport getCoinFlow(ReportDimension dimension, LocalDate from, LocalDate to) {
        List<WalletTransactionRead> transactions = transactionRepository.findByCreatedAtBetween(
                from.atStartOfDay(), to.atTime(LocalTime.MAX));

        // 桶鍵 → [issued, consumed]，TreeMap 讓時間序列依桶鍵排序
        Map<String, long[]> buckets = new TreeMap<>();
        long totalIssued = 0;
        long totalConsumed = 0;

        for (WalletTransactionRead tx : transactions) {
            if (tx.getCreatedAt() == null || tx.getAmount() == null) {
                continue;
            }
            String bucket = dimension.bucketOf(tx.getCreatedAt().toLocalDate());
            long[] agg = buckets.computeIfAbsent(bucket, k -> new long[2]);
            long amount = tx.getAmount();
            if ("DEBIT".equals(tx.getType())) {
                agg[1] += amount;
                totalConsumed += amount;
            } else { // CREDIT / BONUS
                agg[0] += amount;
                totalIssued += amount;
            }
        }

        List<CoinFlowReport.Point> points = new ArrayList<>(buckets.size());
        for (Map.Entry<String, long[]> e : buckets.entrySet()) {
            long issued = e.getValue()[0];
            long consumed = e.getValue()[1];
            points.add(new CoinFlowReport.Point(e.getKey(), issued, consumed, issued - consumed));
        }

        return new CoinFlowReport(
                dimension.name(), from, to,
                totalIssued, totalConsumed, totalIssued - totalConsumed,
                points);
    }
}
