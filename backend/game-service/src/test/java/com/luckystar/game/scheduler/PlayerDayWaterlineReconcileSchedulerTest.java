package com.luckystar.game.scheduler;

import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.luckystar.game.service.RiskControlService;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** {@link PlayerDayWaterlineReconcileScheduler} 單元測試。 */
@ExtendWith(MockitoExtension.class)
class PlayerDayWaterlineReconcileSchedulerTest {

    @Mock
    private RiskControlService riskControlService;

    @InjectMocks
    private PlayerDayWaterlineReconcileScheduler scheduler;

    @Test
    void run_invokesReconcileOnce() {
        scheduler.run();
        verify(riskControlService, times(1)).reconcilePlayerDayWaterlines();
    }

    @Test
    void run_swallowsException() {
        // 排程方法若外拋例外會讓 Spring scheduler 停掉後續執行，故必須被吞掉。
        doThrow(new RuntimeException("boom")).when(riskControlService).reconcilePlayerDayWaterlines();

        Assertions.assertDoesNotThrow(() -> scheduler.run());
    }
}
