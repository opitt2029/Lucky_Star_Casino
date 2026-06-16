package com.luckystar.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

import com.luckystar.admin.dto.LoginResponse;
import com.luckystar.admin.postgres.entity.AdminUser;
import com.luckystar.admin.postgres.repository.AdminUserRepository;
import com.luckystar.admin.security.AdminJwtUtil;
import com.luckystar.admin.security.AdminRole;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

@ExtendWith(MockitoExtension.class)
class AdminAuthServiceTest {

    @Mock
    AdminUserRepository adminUserRepository;

    @Mock
    AdminJwtUtil adminJwtUtil;

    PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    AdminAuthService service;

    @BeforeEach
    void setUp() {
        service = new AdminAuthService(adminUserRepository, passwordEncoder, adminJwtUtil);
    }

    private AdminUser enabledUser(String username, String rawPassword, AdminRole role) {
        return new AdminUser(username, passwordEncoder.encode(rawPassword), role);
    }

    @Test
    void login_validCredentials_returnsTokenAndRole() {
        AdminUser user = enabledUser("superadmin", "secret123", AdminRole.SUPER_ADMIN);
        when(adminUserRepository.findByUsername("superadmin")).thenReturn(Optional.of(user));
        lenient().when(adminJwtUtil.generateToken(user.getId(), "superadmin", AdminRole.SUPER_ADMIN))
                .thenReturn("signed-token");
        lenient().when(adminJwtUtil.getExpiryMs()).thenReturn(3600000L);

        Optional<LoginResponse> response = service.login("superadmin", "secret123");

        assertThat(response).isPresent();
        assertThat(response.get().accessToken()).isEqualTo("signed-token");
        assertThat(response.get().tokenType()).isEqualTo("Bearer");
        assertThat(response.get().role()).isEqualTo("SUPER_ADMIN");
        assertThat(response.get().username()).isEqualTo("superadmin");
    }

    @Test
    void login_wrongPassword_returnsEmpty() {
        AdminUser user = enabledUser("superadmin", "secret123", AdminRole.SUPER_ADMIN);
        when(adminUserRepository.findByUsername("superadmin")).thenReturn(Optional.of(user));

        assertThat(service.login("superadmin", "wrong")).isEmpty();
    }

    @Test
    void login_unknownUser_returnsEmpty() {
        when(adminUserRepository.findByUsername("ghost")).thenReturn(Optional.empty());

        assertThat(service.login("ghost", "whatever")).isEmpty();
    }

    @Test
    void login_disabledUser_returnsEmpty() {
        AdminUser user = enabledUser("operator", "secret123", AdminRole.OPERATOR);
        user.setEnabled(false);
        when(adminUserRepository.findByUsername("operator")).thenReturn(Optional.of(user));

        assertThat(service.login("operator", "secret123")).isEmpty();
    }
}
