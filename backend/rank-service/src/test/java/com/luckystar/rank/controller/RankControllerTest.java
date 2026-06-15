package com.luckystar.rank.controller;

import com.luckystar.rank.dto.RankEntryResponse;
import com.luckystar.rank.service.RankService;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(MockitoExtension.class)
class RankControllerTest {

    @Mock
    RankService rankService;

    MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new RankController(rankService)).build();
    }

    @Test
    void getGlobal_returnsTop100WithPublicContract() throws Exception {
        when(rankService.getTopGlobalCoins()).thenReturn(List.of(
                new RankEntryResponse(7L, "nova", 1L, 9000L)));

        mockMvc.perform(get("/api/v1/rank/global"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].playerId").value(7))
                .andExpect(jsonPath("$[0].username").value("nova"))
                .andExpect(jsonPath("$[0].rank").value(1))
                .andExpect(jsonPath("$[0].score").value(9000))
                .andExpect(jsonPath("$[0].coins").doesNotExist());
    }

    @Test
    void getFriends_usesAuthenticatedPlayerHeader() throws Exception {
        when(rankService.getTopFriendCoins(1L)).thenReturn(List.of(
                new RankEntryResponse(2L, "bob", 1L, 500L)));

        mockMvc.perform(get("/api/v1/rank/friends").header("X-User-Id", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].playerId").value(2))
                .andExpect(jsonPath("$[0].username").value("bob"))
                .andExpect(jsonPath("$[0].rank").value(1))
                .andExpect(jsonPath("$[0].score").value(500));
    }

    @Test
    void getFriends_missingAuthenticatedPlayerHeader_returnsBadRequest() throws Exception {
        mockMvc.perform(get("/api/v1/rank/friends"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void getFriends_arbitraryPlayerPath_isNotExposed() throws Exception {
        mockMvc.perform(get("/api/v1/rank/friend/1/top"))
                .andExpect(status().isNotFound());
    }

    @Test
    void getMyFriendRank_returnsSelfRankAmongFriends() throws Exception {
        when(rankService.getFriendRank(1L)).thenReturn(java.util.Optional.of(
                new RankEntryResponse(1L, "alice", 2L, 2000L)));

        mockMvc.perform(get("/api/v1/rank/friends/me").header("X-User-Id", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.playerId").value(1))
                .andExpect(jsonPath("$.username").value("alice"))
                .andExpect(jsonPath("$.rank").value(2))
                .andExpect(jsonPath("$.score").value(2000));
    }

    @Test
    void getMyFriendRank_returnsNotFoundWhenPlayerNotInFriendRank() throws Exception {
        when(rankService.getFriendRank(99L)).thenReturn(java.util.Optional.empty());

        mockMvc.perform(get("/api/v1/rank/friends/me").header("X-User-Id", "99"))
                .andExpect(status().isNotFound());
    }

    @Test
    void getMyFriendRank_missingAuthenticatedPlayerHeader_returnsBadRequest() throws Exception {
        mockMvc.perform(get("/api/v1/rank/friends/me"))
                .andExpect(status().isBadRequest());
    }
}
