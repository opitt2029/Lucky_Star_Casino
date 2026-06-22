package com.luckystar.rank.scheduler;

import com.luckystar.rank.service.RankService;
import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.scheduling.annotation.Scheduled;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class DailyWinningsResetSchedulerTest {

    @Mock
    RankService rankService;

    @Test
    void resetDailyWinnings_delegatesToRankService() {
        DailyWinningsResetScheduler scheduler = new DailyWinningsResetScheduler(rankService);

        scheduler.resetDailyWinnings();

        verify(rankService).resetDailyWinnings();
    }

    @Test
    void resetDailyWinnings_runsEveryDayAtMidnightInTaipei() throws NoSuchMethodException {
        Method method = DailyWinningsResetScheduler.class.getMethod("resetDailyWinnings");
        Scheduled scheduled = method.getAnnotation(Scheduled.class);

        assertThat(scheduled).isNotNull();
        assertThat(scheduled.cron()).isEqualTo("0 0 0 * * *");
        assertThat(scheduled.zone()).isEqualTo("Asia/Taipei");
    }
}
