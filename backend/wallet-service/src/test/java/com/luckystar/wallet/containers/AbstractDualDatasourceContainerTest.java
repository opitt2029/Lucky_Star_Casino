package com.luckystar.wallet.containers;

import org.junit.jupiter.api.Tag;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.lifecycle.Startables;
import org.testcontainers.utility.MountableFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * ADR-007：雙資料源「真實資料庫」容器測試基底。
 *
 * <p>與既有 H2 測試互補、不取代：H2（surefire 預設 jpa.ddl-auto=create + H2Dialect）
 * 由 entity 反向建表，因此永遠測不到「entity ↔ database/ 真 schema 漂移」、
 * CHECK 約束（chk_wt_sub_type）與真 DB 的鎖語意。本基底改用與 docker-compose
 * 相同版本的 postgres:16 / mysql:8.4，套用 database/ 下的真 init.sql（+ migration），
 * 並以 ddl-auto=validate 啟動——schema 漂移會直接讓 context 起不來。
 *
 * <p>Schema 初始化策略（為什麼兩端不同）：
 * <ul>
 *   <li><b>PostgreSQL</b>：init.sql + 全部 migration 依「數字版號」順序重放。
 *       PG 端 migration 全數冪等（CREATE TABLE IF NOT EXISTS / DROP CONSTRAINT IF EXISTS + ADD /
 *       ADD COLUMN IF NOT EXISTS），可安全疊在最新 init.sql 上；且必須數字排序——
 *       字母序會讓 V9 的 sub_type 白名單蓋掉 V13 的最終版。</li>
 *   <li><b>MySQL</b>：只跑 init.sql。MySQL 端 migration 不冪等（V4 DROP COLUMN、
 *       V8 ADD COLUMN、MySQL 的 DROP CHECK 皆無 IF EXISTS），對已是累積最新版的
 *       init.sql 重放會直接報錯；init.sql 已含全部 migration 的最終結果。</li>
 * </ul>
 *
 * <p>容器為 singleton（static 區塊啟動、全部 containers 測試類共用），避免每類重啟
 * 數十秒的容器；資料清理由各測試類用「專屬 playerId / itemCode」自行負責。
 * KafkaTemplate 以 @MockBean 取代（比照 ShopRedemptionIntegrationTest），
 * 焦點是資料庫語意，不需要真 broker。
 */
@Tag("containers")
@SpringBootTest
public abstract class AbstractDualDatasourceContainerTest {

    static final PostgreSQLContainer<?> POSTGRES;
    static final MySQLContainer<?> MYSQL;

    static {
        // IDE 直接執行時沒有 -Pcontainers-test 的 surefire 設定，這裡再保險一次：
        // 真方言 + validate（surefire profile 已設同值時等效覆寫，無副作用）。
        System.setProperty("jpa.ddl-auto", "validate");
        System.setProperty("jpa.dialect.postgres", "org.hibernate.dialect.PostgreSQLDialect");
        System.setProperty("jpa.dialect.mysql", "org.hibernate.dialect.MySQLDialect");

        // Docker Engine 29+ 的最低 API 版本是 1.40，而 docker-java 預設請求 v1.32 →
        // /info 回 400、Testcontainers 報「Could not find a valid Docker environment」。
        // docker-java 吃 system property `api.version`，固定為 1.44（引擎 MinAPI 以上即可；
        // 對舊引擎（如 CI 的 ubuntu-latest）同樣支援，無副作用）。
        if (System.getProperty("api.version") == null) {
            System.setProperty("api.version", "1.44");
        }

        Path repoRoot = findRepoRoot();

        PostgreSQLContainer<?> pg = new PostgreSQLContainer<>("postgres:16")
                .withDatabaseName("lucky_star_casino")
                .withCopyFileToContainer(
                        MountableFile.forHostPath(repoRoot.resolve("database/postgres/init.sql")),
                        "/docker-entrypoint-initdb.d/00-init.sql");
        int order = 1;
        for (Path migration : postgresMigrationsInVersionOrder(repoRoot)) {
            pg = pg.withCopyFileToContainer(
                    MountableFile.forHostPath(migration),
                    String.format("/docker-entrypoint-initdb.d/%02d-%s", order++, migration.getFileName()));
        }
        POSTGRES = pg;

        MYSQL = new MySQLContainer<>("mysql:8.4")
                .withDatabaseName("lucky_star_casino")
                .withCopyFileToContainer(
                        MountableFile.forHostPath(repoRoot.resolve("database/mysql/init.sql")),
                        "/docker-entrypoint-initdb.d/00-init.sql");

        // 兩容器並行啟動；singleton 模式不手動 stop，由 Testcontainers 的 Ryuk 回收。
        Startables.deepStart(POSTGRES, MYSQL).join();
    }

    @MockBean
    KafkaTemplate<String, String> kafkaTemplate;

    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        // DataSourceConfig 以 @ConfigurationProperties 綁 Hikari，故用 jdbc-url（非 url）。
        registry.add("spring.datasource.jdbc-url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", POSTGRES::getDriverClassName);

        registry.add("spring.datasource-mysql.jdbc-url", MYSQL::getJdbcUrl);
        registry.add("spring.datasource-mysql.username", MYSQL::getUsername);
        registry.add("spring.datasource-mysql.password", MYSQL::getPassword);
        registry.add("spring.datasource-mysql.driver-class-name", MYSQL::getDriverClassName);
    }

    /**
     * 從 surefire 工作目錄（模組根）向上尋找 repo 根：以 database/postgres/init.sql
     * 存在與否判定，避免寫死「上兩層」在不同執行位置（根目錄 -pl / IDE）失效。
     */
    private static Path findRepoRoot() {
        Path dir = Paths.get(System.getProperty("user.dir")).toAbsolutePath();
        while (dir != null) {
            if (Files.exists(dir.resolve("database/postgres/init.sql"))) {
                return dir;
            }
            dir = dir.getParent();
        }
        throw new IllegalStateException(
                "找不到 repo 根（database/postgres/init.sql），user.dir=" + System.getProperty("user.dir"));
    }

    private static List<Path> postgresMigrationsInVersionOrder(Path repoRoot) {
        Pattern version = Pattern.compile("^V(\\d+)__");
        try (Stream<Path> files = Files.list(repoRoot.resolve("database/postgres/migration"))) {
            return files
                    .filter(p -> p.getFileName().toString().endsWith(".sql"))
                    .sorted(Comparator.comparingInt(p -> {
                        Matcher m = version.matcher(p.getFileName().toString());
                        if (!m.find()) {
                            throw new IllegalStateException("migration 檔名缺版號: " + p.getFileName());
                        }
                        return Integer.parseInt(m.group(1));
                    }))
                    .toList();
        } catch (java.io.IOException e) {
            throw new IllegalStateException("讀取 postgres migration 目錄失敗", e);
        }
    }
}
