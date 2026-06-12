package com.luckystar.rank.scheduler;

import com.luckystar.rank.service.WeeklyRankResetService;
import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.scheduling.annotation.Scheduled;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class WeeklyRankResetSchedulerTest {

    @Mock
    WeeklyRankResetService weeklyRankResetService;

    @Test
    void resetWeeklyRank_delegatesToService() {
        WeeklyRankResetScheduler scheduler = new WeeklyRankResetScheduler(weeklyRankResetService);

        scheduler.resetWeeklyRank();

        verify(weeklyRankResetService).resetWeeklyRank();
    }

    @Test
    void resetWeeklyRank_runsEveryMondayAtMidnightInTaipei() throws NoSuchMethodException {
        Method method = WeeklyRankResetScheduler.class.getMethod("resetWeeklyRank");
        Scheduled scheduled = method.getAnnotation(Scheduled.class);

        assertThat(scheduled).isNotNull();
        assertThat(scheduled.cron()).isEqualTo("0 0 0 * * MON");
        assertThat(scheduled.zone()).isEqualTo("Asia/Taipei");
    }
}
