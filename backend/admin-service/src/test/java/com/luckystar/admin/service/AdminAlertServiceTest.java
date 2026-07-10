package com.luckystar.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.luckystar.admin.dto.AlertView;
import com.luckystar.admin.postgres.entity.AdminActionLog;
import com.luckystar.admin.postgres.entity.AdminAlert;
import com.luckystar.admin.postgres.repository.AdminActionLogRepository;
import com.luckystar.admin.postgres.repository.AdminAlertRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

@ExtendWith(MockitoExtension.class)
class AdminAlertServiceTest {

    @Mock AdminAlertRepository alertRepository;
    @Mock AdminActionLogRepository actionLogRepository;

    AdminAlertService service;

    final Pageable pageable = PageRequest.of(0, 20);

    @BeforeEach
    void setUp() {
        service = new AdminAlertService(alertRepository, actionLogRepository);
    }

    private Page<AdminAlert> pageOf(AdminAlert... alerts) {
        return new PageImpl<>(List.of(alerts), pageable, alerts.length);
    }

    @Test
    void list_noFilters_usesFindAll() {
        when(alertRepository.findAll(pageable))
                .thenReturn(pageOf(new AdminAlert(1L, "BIG_WIN", "payout 60000 > 50000")));

        Page<AlertView> result = service.list(null, null, pageable);

        assertThat(result.getContent()).singleElement()
                .satisfies(v -> {
                    assertThat(v.alertType()).isEqualTo("BIG_WIN");
                    assertThat(v.resolved()).isFalse();
                });
        verify(alertRepository, never()).findByResolved(any(Boolean.class), any());
    }

    @Test
    void list_resolvedOnly_usesFindByResolved() {
        when(alertRepository.findByResolved(false, pageable))
                .thenReturn(pageOf(new AdminAlert(1L, "HIGH_FREQUENCY", "bet count 101 > 100")));

        Page<AlertView> result = service.list("  ", false, pageable);

        assertThat(result.getTotalElements()).isEqualTo(1);
        verify(alertRepository).findByResolved(false, pageable);
        verify(alertRepository, never()).findAll(any(Pageable.class));
    }

    @Test
    void list_typeOnly_usesFindByAlertType() {
        when(alertRepository.findByAlertType("BIG_WIN", pageable)).thenReturn(pageOf());

        service.list("BIG_WIN", null, pageable);

        verify(alertRepository).findByAlertType("BIG_WIN", pageable);
    }

    @Test
    void list_typeAndResolved_usesCombinedQuery() {
        when(alertRepository.findByAlertTypeAndResolved("ABNORMAL_TRANSFER", true, pageable))
                .thenReturn(pageOf());

        service.list("ABNORMAL_TRANSFER", true, pageable);

        verify(alertRepository).findByAlertTypeAndResolved("ABNORMAL_TRANSFER", true, pageable);
    }

    @Test
    void resolve_found_marksResolvedRecordsOperatorAndWritesAudit() {
        AdminAlert alert = new AdminAlert(7L, "BIG_WIN", "detail");
        when(alertRepository.findById(1L)).thenReturn(Optional.of(alert));
        when(alertRepository.save(alert)).thenReturn(alert);

        Optional<AlertView> result = service.resolve(1L, "operator1");

        assertThat(result).isPresent();
        assertThat(result.get().resolved()).isTrue();
        assertThat(result.get().resolvedBy()).isEqualTo("operator1");
        assertThat(result.get().resolvedAt()).isNotNull();
        assertThat(alert.isResolved()).isTrue();
        verify(alertRepository).save(alert);

        // 稽核：落一筆 admin_action_logs（操作者 / ALERT_RESOLVE / 目標玩家 / 確定性冪等鍵）
        ArgumentCaptor<AdminActionLog> logCaptor = ArgumentCaptor.forClass(AdminActionLog.class);
        verify(actionLogRepository).save(logCaptor.capture());
        AdminActionLog logged = logCaptor.getValue();
        assertThat(logged.getOperator()).isEqualTo("operator1");
        assertThat(logged.getActionType()).isEqualTo("ALERT_RESOLVE");
        assertThat(logged.getTargetPlayerId()).isEqualTo(7L);
        assertThat(logged.getIdempotencyKey()).isEqualTo("alert-resolve-1");
    }

    @Test
    void resolve_alreadyResolved_isIdempotentAndDoesNotClobberOrReAudit() {
        AdminAlert alert = new AdminAlert(7L, "BIG_WIN", "detail");
        alert.markResolved("firstOperator");
        when(alertRepository.findById(1L)).thenReturn(Optional.of(alert));

        Optional<AlertView> result = service.resolve(1L, "secondOperator");

        assertThat(result).isPresent();
        assertThat(result.get().resolved()).isTrue();
        // 保留第一位處理者，不被後續呼叫覆寫
        assertThat(result.get().resolvedBy()).isEqualTo("firstOperator");
        // 已處理不再寫庫、不再重複稽核
        verify(alertRepository, never()).save(any());
        verify(actionLogRepository, never()).save(any());
    }

    @Test
    void resolve_notFound_returnsEmpty() {
        when(alertRepository.findById(99L)).thenReturn(Optional.empty());

        assertThat(service.resolve(99L, "operator1")).isEmpty();
        verify(alertRepository, never()).save(any());
        verify(actionLogRepository, never()).save(any());
    }
}
