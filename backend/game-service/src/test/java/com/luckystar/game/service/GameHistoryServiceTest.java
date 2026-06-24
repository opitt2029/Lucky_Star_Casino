package com.luckystar.game.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.luckystar.game.dto.GameHistoryResponse;
import com.luckystar.game.dto.GameRecordView;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.repository.GameRoundRepository;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

/** {@link GameHistoryService} 單元測試（純 Mockito）。 */
class GameHistoryServiceTest {

    private final GameRoundRepository roundRepository =
            org.mockito.Mockito.mock(GameRoundRepository.class);

    private GameHistoryService service;

    @BeforeEach
    void setUp() {
        service = new GameHistoryService(roundRepository);
    }

    private static GameRound round(String roundId, String gameType, long bet, long win) {
        GameRound r = new GameRound();
        r.setRoundId(roundId);
        r.setGameType(gameType);
        r.setNonce(0L);
        r.setBetAmount(bet);
        r.setWinAmount(win);
        r.setBalanceBefore(1000L);
        r.setBalanceAfter(1000L - bet + win);
        r.setBetAt(LocalDateTime.of(2026, 6, 24, 12, 0, 0, 123_000_000));
        r.setSettledAt(LocalDateTime.of(2026, 6, 24, 12, 0, 1, 456_000_000));
        r.setStatus("SETTLED");
        r.setServerSeedHash("hash-" + roundId);
        r.setClientSeed("client-" + roundId);
        r.setResultData("{}");
        return r;
    }

    @Test
    @DisplayName("history：ALL/null/空白皆查全部類型，回傳分頁形狀並算淨損益")
    void history_allTypes_mapsViewAndProfit() {
        GameRound win = round("r-win", "SLOT", 100L, 250L);
        Page<GameRound> page = new PageImpl<>(List.of(win), PageRequest.of(0, 10), 1);
        when(roundRepository.findByPlayerIdOrderByCreatedAtDesc(eq(7L), org.mockito.ArgumentMatchers.any()))
                .thenReturn(page);

        GameHistoryResponse resp = service.history(7L, null, 1, 10);

        assertEquals(1, resp.getItems().size());
        assertEquals(1L, resp.getTotal());
        assertEquals(1, resp.getPage());
        assertEquals(10, resp.getPageSize());
        GameRecordView v = resp.getItems().get(0);
        assertEquals("r-win", v.getRoundId());
        assertEquals(150L, v.getProfit(), "profit = win - bet");
        assertEquals(1000L, v.getBalanceBefore());
        assertEquals(1150L, v.getBalanceAfter());
        verify(roundRepository).findByPlayerIdOrderByCreatedAtDesc(eq(7L), org.mockito.ArgumentMatchers.any());
        verifyNoMoreInteractions(roundRepository);
    }

    @Test
    @DisplayName("history：指定 gameType 走類型過濾查詢，型別正規化為大寫")
    void history_typeFilter_normalisesUppercase() {
        Page<GameRound> page = new PageImpl<>(List.of(round("r1", "BACCARAT", 200L, 0L)));
        when(roundRepository.findByPlayerIdAndGameTypeOrderByCreatedAtDesc(
                eq(7L), eq("BACCARAT"), org.mockito.ArgumentMatchers.any()))
                .thenReturn(page);

        GameHistoryResponse resp = service.history(7L, "baccarat", 1, 10);

        assertEquals(1, resp.getItems().size());
        assertEquals(-200L, resp.getItems().get(0).getProfit(), "全輸時 profit = -bet");
        verify(roundRepository).findByPlayerIdAndGameTypeOrderByCreatedAtDesc(
                eq(7L), eq("BACCARAT"), org.mockito.ArgumentMatchers.any());
    }

    @Test
    @DisplayName("history：page/pageSize 越界時被夾在合法區間（page≥1、pageSize≤50）")
    void history_clampsPaging() {
        when(roundRepository.findByPlayerIdOrderByCreatedAtDesc(eq(7L), org.mockito.ArgumentMatchers.any()))
                .thenReturn(new PageImpl<>(List.of()));

        GameHistoryResponse resp = service.history(7L, "ALL", 0, 9999);

        assertEquals(1, resp.getPage(), "page < 1 應夾為 1");
        assertEquals(50, resp.getPageSize(), "pageSize 應夾至上限 50");

        ArgumentCaptor<Pageable> cap = ArgumentCaptor.forClass(Pageable.class);
        verify(roundRepository).findByPlayerIdOrderByCreatedAtDesc(eq(7L), cap.capture());
        assertEquals(0, cap.getValue().getPageNumber(), "1-based page 轉 0-based");
        assertEquals(50, cap.getValue().getPageSize());
    }

    @Test
    @DisplayName("toView：bet/win 任一為 null 時 profit 為 null（不誤算）")
    void history_nullAmounts_profitNull() {
        GameRound r = round("r-null", "FISHING", 0L, 0L);
        r.setBetAmount(null);
        when(roundRepository.findByPlayerIdOrderByCreatedAtDesc(eq(7L), org.mockito.ArgumentMatchers.any()))
                .thenReturn(new PageImpl<>(List.of(r)));

        GameHistoryResponse resp = service.history(7L, "ALL", 1, 10);

        assertNull(resp.getItems().get(0).getProfit());
    }
}
