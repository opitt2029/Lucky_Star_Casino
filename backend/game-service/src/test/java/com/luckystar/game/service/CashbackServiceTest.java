package com.luckystar.game.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.luckystar.game.entity.CashbackRecord;
import com.luckystar.game.kafka.CashbackEventPublisher;
import com.luckystar.game.repository.CashbackRecordRepository;
import com.luckystar.game.repository.GameRoundRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class CashbackServiceTest {

    private final GameRoundRepository      roundRepo      = org.mockito.Mockito.mock(GameRoundRepository.class);
    private final CashbackRecordRepository cashbackRepo   = org.mockito.Mockito.mock(CashbackRecordRepository.class);
    private final CashbackEventPublisher   publisher      = org.mockito.Mockito.mock(CashbackEventPublisher.class);

    private CashbackService service;

    @BeforeEach
    void setUp() {
        service = new CashbackService(roundRepo, cashbackRepo, publisher);
        when(cashbackRepo.existsByPlayerIdAndPeriodTypeAndPeriodStart(anyLong(), anyString(), any()))
                .thenReturn(false);
        when(cashbackRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    // ---- 階梯費率 ----

    @Nested
    @DisplayName("dailyRate 階梯")
    class DailyRateTest {
        @Test void below1000_null()   { assertNull(CashbackService.dailyRate(999)); }
        @Test void at1000_5pct()      { assertEquals(new BigDecimal("0.05"), CashbackService.dailyRate(1_000)); }
        @Test void at4999_5pct()      { assertEquals(new BigDecimal("0.05"), CashbackService.dailyRate(4_999)); }
        @Test void at5000_8pct()      { assertEquals(new BigDecimal("0.08"), CashbackService.dailyRate(5_000)); }
        @Test void at9999_8pct()      { assertEquals(new BigDecimal("0.08"), CashbackService.dailyRate(9_999)); }
        @Test void at10000_10pct()    { assertEquals(new BigDecimal("0.10"), CashbackService.dailyRate(10_000)); }
        @Test void above10000_10pct() { assertEquals(new BigDecimal("0.10"), CashbackService.dailyRate(99_999)); }
    }

    @Nested
    @DisplayName("weeklyRate 階梯")
    class WeeklyRateTest {
        @Test void below3000_null()    { assertNull(CashbackService.weeklyRate(2_999)); }
        @Test void at3000_8pct()       { assertEquals(new BigDecimal("0.08"), CashbackService.weeklyRate(3_000)); }
        @Test void at4999_8pct()       { assertEquals(new BigDecimal("0.08"), CashbackService.weeklyRate(4_999)); }
        @Test void at5000_12pct()      { assertEquals(new BigDecimal("0.12"), CashbackService.weeklyRate(5_000)); }
        @Test void at9999_12pct()      { assertEquals(new BigDecimal("0.12"), CashbackService.weeklyRate(9_999)); }
        @Test void at10000_15pct()     { assertEquals(new BigDecimal("0.15"), CashbackService.weeklyRate(10_000)); }
        @Test void above10000_15pct()  { assertEquals(new BigDecimal("0.15"), CashbackService.weeklyRate(50_000)); }
    }

    // ---- processDailyCashback ----

    @Test
    @DisplayName("日返利：虧損 2000（5%）→ 入帳 100 + 推播")
    void daily_loss2000_credits100() throws Exception {
        LocalDate date = LocalDate.of(2026, 6, 22);
        // player 1: bet=5000, win=3000, netLoss=2000
        when(roundRepo.aggregateNetLossPerPlayer(any(LocalDateTime.class), any(LocalDateTime.class)))
                .thenReturn(rows(new Object[]{1L, 5000L, 3000L}));

        int credited = service.processDailyCashback(date);

        assertEquals(1, credited);
        ArgumentCaptor<CashbackRecord> cap = ArgumentCaptor.forClass(CashbackRecord.class);
        verify(cashbackRepo, times(2)).save(cap.capture()); // PENDING + CREDITED
        CashbackRecord last = cap.getAllValues().get(1);
        assertEquals("CREDITED", last.getStatus());
        assertEquals(100L, last.getCashbackAmount()); // floor(2000 * 0.05)
        assertEquals("DAILY", last.getPeriodType());
        verify(publisher).publishCredit(eq(1L), eq(100L), anyString());
        verify(publisher).publishNotification(eq(1L), eq("DAILY"), eq(date), eq(2000L), eq(100L));
    }

    @Test
    @DisplayName("日返利：虧損 999（未達門檻）→ 不發放")
    void daily_loss999_skipped() throws Exception {
        LocalDate date = LocalDate.of(2026, 6, 22);
        when(roundRepo.aggregateNetLossPerPlayer(any(), any()))
                .thenReturn(rows(new Object[]{1L, 1999L, 1000L})); // netLoss=999

        int credited = service.processDailyCashback(date);

        assertEquals(0, credited);
        verify(publisher, never()).publishCredit(anyLong(), anyLong(), anyString());
    }

    @Test
    @DisplayName("日返利：同一玩家同一天已有記錄 → 跳過（冪等）")
    void daily_alreadyExists_skipped() throws Exception {
        LocalDate date = LocalDate.of(2026, 6, 22);
        when(roundRepo.aggregateNetLossPerPlayer(any(), any()))
                .thenReturn(rows(new Object[]{1L, 5000L, 3000L}));
        when(cashbackRepo.existsByPlayerIdAndPeriodTypeAndPeriodStart(1L, "DAILY", date))
                .thenReturn(true);

        int credited = service.processDailyCashback(date);

        assertEquals(0, credited);
        verify(cashbackRepo, never()).save(any());
        verify(publisher, never()).publishCredit(anyLong(), anyLong(), anyString());
    }

    @Test
    @DisplayName("日返利：多位玩家，各自套用對應費率")
    void daily_multiplePlayers() throws Exception {
        LocalDate date = LocalDate.of(2026, 6, 22);
        when(roundRepo.aggregateNetLossPerPlayer(any(), any()))
                .thenReturn(rows(
                        new Object[]{1L, 3000L, 1000L},
                        new Object[]{2L, 10000L, 4000L},
                        new Object[]{3L, 20000L, 5000L}
                ));

        int credited = service.processDailyCashback(date);

        assertEquals(3, credited);
        verify(publisher).publishCredit(eq(1L), eq(100L),  anyString());
        verify(publisher).publishCredit(eq(2L), eq(480L),  anyString());
        verify(publisher).publishCredit(eq(3L), eq(1500L), anyString());
    }

    // ---- processWeeklyCashback ----

    @Test
    @DisplayName("週返利：虧損 4000（8%）→ 入帳 320")
    void weekly_loss4000_credits320() throws Exception {
        LocalDate weekStart = LocalDate.of(2026, 6, 16); // 週一
        when(roundRepo.aggregateNetLossPerPlayer(any(), any()))
                .thenReturn(rows(new Object[]{5L, 8000L, 4000L})); // netLoss=4000

        int credited = service.processWeeklyCashback(weekStart);

        assertEquals(1, credited);
        verify(publisher).publishCredit(eq(5L), eq(320L), anyString()); // floor(4000*0.08)
        verify(publisher).publishNotification(eq(5L), eq("WEEKLY"), eq(weekStart), eq(4000L), eq(320L));
    }

    @Test
    @DisplayName("週返利：虧損 2999（未達門檻 3000）→ 不發放")
    void weekly_loss2999_skipped() throws Exception {
        LocalDate weekStart = LocalDate.of(2026, 6, 16);
        when(roundRepo.aggregateNetLossPerPlayer(any(), any()))
                .thenReturn(rows(new Object[]{5L, 5000L, 2001L})); // netLoss=2999

        int credited = service.processWeeklyCashback(weekStart);

        assertEquals(0, credited);
        verify(publisher, never()).publishCredit(anyLong(), anyLong(), anyString());
    }

    private static List<Object[]> rows(Object[]... arrays) {
        List<Object[]> list = new ArrayList<>();
        for (Object[] arr : arrays) list.add(arr);
        return list;
    }
}
