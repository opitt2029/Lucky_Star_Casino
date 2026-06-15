package com.luckystar.admin.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.luckystar.admin.dto.PlayerStatusResponse;
import com.luckystar.admin.dto.PlayerSummary;
import com.luckystar.admin.service.AdminPlayerService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class AdminPlayerControllerTest {

    @Mock
    AdminPlayerService adminPlayerService;

    MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new AdminPlayerController(adminPlayerService)).build();
    }

    @Test
    void listPlayers_returnsPagedSummaries() throws Exception {
        PlayerSummary summary = new PlayerSummary(1L, "alice", "Alice", "PLAYER", "ACTIVE", false, null);
        when(adminPlayerService.listPlayers(any(), any()))
                .thenReturn(new PageImpl<>(List.of(summary), PageRequest.of(0, 20), 1));

        mockMvc.perform(get("/admin/players?page=0&size=20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].playerId").value(1))
                .andExpect(jsonPath("$.content[0].username").value("alice"));
    }

    @Test
    void getPlayer_notFound_returns404() throws Exception {
        when(adminPlayerService.getPlayerDetail(99L)).thenReturn(Optional.empty());

        mockMvc.perform(get("/admin/players/99")).andExpect(status().isNotFound());
    }

    @Test
    void setStatus_disable_returnsDisabledTrue() throws Exception {
        when(adminPlayerService.setStatus(eq(1L), eq(false)))
                .thenReturn(Optional.of(new PlayerStatusResponse(1L, true)));

        mockMvc.perform(patch("/admin/players/1/status")
                        .contentType("application/json")
                        .content("{\"enabled\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.playerId").value(1))
                .andExpect(jsonPath("$.disabled").value(true));
    }

    @Test
    void setStatus_unknownPlayer_returns404() throws Exception {
        when(adminPlayerService.setStatus(eq(99L), eq(true))).thenReturn(Optional.empty());

        mockMvc.perform(patch("/admin/players/99/status")
                        .contentType("application/json")
                        .content("{\"enabled\":true}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void setStatus_missingEnabledField_returns400() throws Exception {
        mockMvc.perform(patch("/admin/players/1/status")
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }
}
