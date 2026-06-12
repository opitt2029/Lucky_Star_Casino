package com.luckystar.rank.scheduler;

import com.luckystar.rank.service.DailyRankSnapshotService;
import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.scheduling.annotation.Scheduled;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class DailyRankSnapshotSchedulerTest {

    @Mock
    DailyRankSnapshotService dailyRankSnapshotService;

    @Test
    void snapshotDailyBalances_delegatesToService() {
        DailyRankSnapshotScheduler scheduler = new DailyRankSnapshotScheduler(dailyRankSnapshotService);

        scheduler.snapshotDailyBalances();

        verify(dailyRankSnapshotService).snapshotDailyBalances();
    }

    @Test
    void snapshotDailyBalances_runsEveryDayAtMidnightInTaipei() throws NoSuchMethodException {
        Method method = DailyRankSnapshotScheduler.class.getMethod("snapshotDailyBalances");
        Scheduled scheduled = method.getAnnotation(Scheduled.class);

        assertThat(scheduled).isNotNull();
        assertThat(scheduled.cron()).isEqualTo("0 0 0 * * *");
        assertThat(scheduled.zone()).isEqualTo("Asia/Taipei");
    }
}
