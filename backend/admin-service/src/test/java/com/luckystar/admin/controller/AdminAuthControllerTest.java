package com.luckystar.admin.controller;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.luckystar.admin.dto.LoginResponse;
import com.luckystar.admin.service.AdminAuthService;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class AdminAuthControllerTest {

    @Mock
    AdminAuthService adminAuthService;

    MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new AdminAuthController(adminAuthService)).build();
    }

    @Test
    void login_validCredentials_returns200WithToken() throws Exception {
        when(adminAuthService.login("superadmin", "secret123")).thenReturn(Optional.of(
                new LoginResponse("signed-token", "Bearer", 3600000L, "superadmin", "SUPER_ADMIN")));

        mockMvc.perform(post("/admin/auth/login")
                        .contentType("application/json")
                        .content("{\"username\":\"superadmin\",\"password\":\"secret123\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("signed-token"))
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.role").value("SUPER_ADMIN"));
    }

    @Test
    void login_badCredentials_returns401() throws Exception {
        when(adminAuthService.login("superadmin", "wrong")).thenReturn(Optional.empty());

        mockMvc.perform(post("/admin/auth/login")
                        .contentType("application/json")
                        .content("{\"username\":\"superadmin\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void login_blankFields_returns400() throws Exception {
        mockMvc.perform(post("/admin/auth/login")
                        .contentType("application/json")
                        .content("{\"username\":\"\",\"password\":\"\"}"))
                .andExpect(status().isBadRequest());
    }
}
