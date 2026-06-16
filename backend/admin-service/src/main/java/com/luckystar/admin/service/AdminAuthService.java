package com.luckystar.admin.service;

import com.luckystar.admin.dto.LoginResponse;
import com.luckystar.admin.postgres.entity.AdminUser;
import com.luckystar.admin.postgres.repository.AdminUserRepository;
import com.luckystar.admin.security.AdminJwtUtil;
import java.util.Optional;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 後台登入流程（T-050）：驗 BCrypt 密碼 → 簽發後台 JWT。
 */
@Service
public class AdminAuthService {

    private final AdminUserRepository adminUserRepository;
    private final PasswordEncoder passwordEncoder;
    private final AdminJwtUtil adminJwtUtil;

    public AdminAuthService(AdminUserRepository adminUserRepository,
                            PasswordEncoder passwordEncoder,
                            AdminJwtUtil adminJwtUtil) {
        this.adminUserRepository = adminUserRepository;
        this.passwordEncoder = passwordEncoder;
        this.adminJwtUtil = adminJwtUtil;
    }

    /**
     * 驗證帳密並簽發 token；帳號不存在 / 已停用 / 密碼錯誤皆回 {@link Optional#empty()}
     * （不區分原因，避免帳號列舉）。
     */
    @Transactional(transactionManager = "postgresTransactionManager", readOnly = true)
    public Optional<LoginResponse> login(String username, String rawPassword) {
        return adminUserRepository.findByUsername(username)
                .filter(AdminUser::isEnabled)
                .filter(user -> passwordEncoder.matches(rawPassword, user.getPasswordHash()))
                .map(user -> new LoginResponse(
                        adminJwtUtil.generateToken(user.getId(), user.getUsername(), user.getRole()),
                        "Bearer",
                        adminJwtUtil.getExpiryMs(),
                        user.getUsername(),
                        user.getRole().name()));
    }
}
