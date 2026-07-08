package com.luckystar.admin.config;

import com.luckystar.admin.postgres.entity.AdminUser;
import com.luckystar.admin.postgres.repository.AdminUserRepository;
import com.luckystar.admin.security.AdminRole;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 啟動時播種一個預設 {@code SUPER_ADMIN}（T-050），讓後台首次可登入。
 *
 * 僅在 {@code admin.seed.enabled=true} 且該帳號尚未存在時建立；密碼由
 * {@code admin.seed.password} 提供並以 BCrypt 雜湊（不在 schema 硬編雜湊）。
 * 預設值 {@code enabled=false}——沒設 {@code ADMIN_SEED_ENABLED} 就不會用版控裡公開的
 * 預設密碼播種帳號；本機開發由 {@code .env} 明確設 {@code ADMIN_SEED_ENABLED=true} 開啟。
 * 正式環境如需播種，請以環境變數覆蓋帳密，並於首登後立即更換。
 */
@Component
public class AdminUserSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminUserSeeder.class);

    private final AdminUserRepository adminUserRepository;
    private final PasswordEncoder passwordEncoder;
    private final boolean enabled;
    private final String username;
    private final String password;

    public AdminUserSeeder(AdminUserRepository adminUserRepository,
                           PasswordEncoder passwordEncoder,
                           @Value("${admin.seed.enabled:false}") boolean enabled,
                           @Value("${admin.seed.username:superadmin}") String username,
                           @Value("${admin.seed.password:ChangeMe!SuperAdmin123}") String password) {
        this.adminUserRepository = adminUserRepository;
        this.passwordEncoder = passwordEncoder;
        this.enabled = enabled;
        this.username = username;
        this.password = password;
    }

    @Override
    @Transactional(transactionManager = "postgresTransactionManager")
    public void run(String... args) {
        if (!enabled) {
            return;
        }
        if (adminUserRepository.existsByUsername(username)) {
            return;
        }
        adminUserRepository.save(new AdminUser(
                username,
                passwordEncoder.encode(password),
                AdminRole.SUPER_ADMIN));
        log.warn("Seeded default SUPER_ADMIN '{}'. CHANGE THE PASSWORD in production!", username);
    }
}
