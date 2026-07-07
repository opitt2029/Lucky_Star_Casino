package com.luckystar.admin.service;

import com.luckystar.admin.dto.AlertView;
import com.luckystar.admin.postgres.entity.AdminAlert;
import com.luckystar.admin.postgres.repository.AdminAlertRepository;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/**
 * 異常告警查詢與處理（T-054 查詢端）。
 *
 * 寫入端在 {@link AlertRuleEngine}（Kafka 消費觸發）；這裡提供後台的
 * 列表篩選（類型 / 是否已處理）與「標記已處理」。admin_alerts 在 PostgreSQL，
 * 一律掛 {@code postgresTransactionManager}（雙資料源，預設 TM 是 MySQL 端）。
 */
@Service
public class AdminAlertService {

    private final AdminAlertRepository alertRepository;

    public AdminAlertService(AdminAlertRepository alertRepository) {
        this.alertRepository = alertRepository;
    }

    /** 列表：alertType / resolved 皆可不帶（不帶 = 不篩選）。 */
    @Transactional(value = "postgresTransactionManager", readOnly = true)
    public Page<AlertView> list(String alertType, Boolean resolved, Pageable pageable) {
        boolean hasType = StringUtils.hasText(alertType);
        Page<AdminAlert> page;
        if (hasType && resolved != null) {
            page = alertRepository.findByAlertTypeAndResolved(alertType, resolved, pageable);
        } else if (hasType) {
            page = alertRepository.findByAlertType(alertType, pageable);
        } else if (resolved != null) {
            page = alertRepository.findByResolved(resolved, pageable);
        } else {
            page = alertRepository.findAll(pageable);
        }
        return page.map(AlertView::from);
    }

    /**
     * 標記已處理。冪等：已處理再標一次仍回 200（結果相同），不視為錯誤。
     * 告警不存在回 {@link Optional#empty()}（→ 404）。
     */
    @Transactional("postgresTransactionManager")
    public Optional<AlertView> resolve(Long alertId) {
        return alertRepository.findById(alertId).map(alert -> {
            alert.markResolved();
            return AlertView.from(alertRepository.save(alert));
        });
    }
}
