package com.luckystar.game.controller;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.luckystar.game.dto.RtpStatView;
import com.luckystar.game.service.RtpStatsService;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

/** {@link RtpController} web 層測試（@WebMvcTest）。 */
@WebMvcTest(RtpController.class)
class RtpControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private RtpStatsService rtpStatsService;

    @Test
    @DisplayName("GET /rtp：200，回傳各遊戲最新 RTP")
    void latest_happyPath() throws Exception {
        RtpStatView slot = RtpStatView.builder()
                .gameType("SLOT").totalBet(10000).totalWin(1760).roundCount(100)
                .rtp(0.176).calculatedAt(LocalDateTime.now()).build();
        when(rtpStatsService.latestStats()).thenReturn(List.of(slot));

        mockMvc.perform(get("/api/v1/game/rtp"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data[0].gameType").value("SLOT"))
                .andExpect(jsonPath("$.data[0].rtp").value(0.176));
    }
}
