package com.luckystar.admin.service;

import com.luckystar.admin.dto.AlertView;
import com.luckystar.admin.postgres.entity.AdminActionLog;
import com.luckystar.admin.postgres.entity.AdminAlert;
import com.luckystar.admin.postgres.repository.AdminActionLogRepository;
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

    /** admin_action_logs 的 action_type：告警標記已處理。 */
    static final String ACTION_TYPE = "ALERT_RESOLVE";

    private final AdminAlertRepository alertRepository;
    private final AdminActionLogRepository actionLogRepository;

    public AdminAlertService(AdminAlertRepository alertRepository,
                             AdminActionLogRepository actionLogRepository) {
        this.alertRepository = alertRepository;
        this.actionLogRepository = actionLogRepository;
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
     * 標記已處理，記錄處理者（{@code resolved_by}/{@code resolved_at}）並落一筆
     * {@code admin_action_logs}（action_type = {@value #ACTION_TYPE}）。稽核與狀態變更同在
     * postgres 交易內，稽核寫不進去則整筆 rollback（比照 GM 發幣，不採 best-effort）。
     *
     * <p>冪等：已處理再標一次仍回 200，但<b>不</b>覆寫原處理者、<b>不</b>重複寫稽核——保留第一位
     * 處理者的紀錄。告警不存在回 {@link Optional#empty()}（→ 404）。
     * 稽核 idempotency_key 用 {@code alert-resolve-<id>}（確定性），為並發雙重處理再加一道 UNIQUE 防線。
     */
    @Transactional("postgresTransactionManager")
    public Optional<AlertView> resolve(Long alertId, String operator) {
        return alertRepository.findById(alertId).map(alert -> {
            if (alert.isResolved()) {
                return AlertView.from(alert);
            }
            alert.markResolved(operator);
            AlertView view = AlertView.from(alertRepository.save(alert));
            actionLogRepository.save(new AdminActionLog(
                    operator, ACTION_TYPE, alert.getPlayerId(), null,
                    alert.getAlertType(), "alert-resolve-" + alertId));
            return view;
        });
    }
}
