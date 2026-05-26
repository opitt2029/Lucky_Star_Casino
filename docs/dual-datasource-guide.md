# 雙 DataSource 使用指南

> 適用服務：`wallet-service`、`admin-service`  
> 架構依據：[ADR-001 資料庫分配決策](adr/ADR-001.md)

---

## 為什麼需要雙 DataSource？

依照 ADR-001 的 CQRS 設計，這兩個服務各自同時連接兩個資料庫：

| 服務 | 主庫（@Primary） | 次庫 |
|------|-----------------|------|
| `wallet-service` | PostgreSQL 5433（帳務寫庫） | MySQL 3307（查詢讀庫） |
| `admin-service`  | MySQL 3307（各服務查詢）    | PostgreSQL 5433（寫 admin_alerts） |

Spring Boot 的 JPA 自動配置只認識 `spring.datasource`（主庫），次庫需要手動定義 Bean 並以 `@Qualifier` 注入。

---

## 設定架構

```
spring.datasource          → 主庫，由 Spring Boot JPA 自動配置
spring.datasource-mysql    → 次庫（wallet-service 使用）
spring.datasource-postgres → 次庫（admin-service 使用）
```

次庫的連線參數定義在各服務的 `application.yml`，Bean 則在 `config/DataSourceConfig.java` 中建立。

---

## wallet-service 使用方式

### 場景：T-025 帳務流水查詢（走 MySQL 讀庫）

```java
@Repository
public class TransactionReadRepository {

    private final JdbcTemplate mysqlJdbcTemplate;

    // 注入次庫：MySQL 讀庫
    public TransactionReadRepository(
            @Qualifier("mysqlDataSource") DataSource mysqlDataSource) {
        this.mysqlJdbcTemplate = new JdbcTemplate(mysqlDataSource);
    }

    public List<TransactionRecord> findByPlayerId(Long playerId, int page, int size) {
        String sql = """
                SELECT * FROM wallet_transactions
                WHERE player_id = ?
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """;
        return mysqlJdbcTemplate.query(sql,
                new TransactionRowMapper(),
                playerId, size, (long) page * size);
    }
}
```

### 場景：T-022 下注扣款（走 PostgreSQL 主庫，直接用 JPA Repository）

```java
// JPA Repository 預設使用主庫（PostgreSQL），不需要特別指定
@Repository
public interface WalletRepository extends JpaRepository<Wallet, Long> {

    // 樂觀鎖查詢（UPDATE ... WHERE version = ?）
    @Lock(LockModeType.OPTIMISTIC)
    Optional<Wallet> findByPlayerId(Long playerId);
}
```

---

## admin-service 使用方式

### 場景：寫入 admin_alerts（走 PostgreSQL 次庫）

```java
@Repository
public class AdminAlertRepository {

    private final JdbcTemplate postgresJdbcTemplate;

    // 注入次庫：PostgreSQL
    public AdminAlertRepository(
            @Qualifier("postgresDataSource") DataSource postgresDataSource) {
        this.postgresJdbcTemplate = new JdbcTemplate(postgresDataSource);
    }

    public void saveAlert(AdminAlert alert) {
        String sql = """
                INSERT INTO admin_alerts (player_id, alert_type, message, created_at)
                VALUES (?, ?, ?, NOW())
                """;
        postgresJdbcTemplate.update(sql,
                alert.getPlayerId(),
                alert.getAlertType(),
                alert.getMessage());
    }
}
```

### 場景：查詢玩家資料（走 MySQL 主庫，直接用 JPA Repository）

```java
// JPA Repository 預設使用主庫（MySQL），直接繼承即可
@Repository
public interface MemberQueryRepository extends JpaRepository<Member, Long> {

    List<Member> findByStatusAndCreatedAtAfter(String status, LocalDateTime since);
}
```

---

## 注意事項

### 不要讓 JPA 管理次庫的 Entity

次庫的 DataSource Bean 只是一個普通的連線池，Spring JPA 不會掃描它。若要使用 JPA 操作次庫，需要額外設定獨立的 `EntityManagerFactory`（目前架構不需要，用 `JdbcTemplate` 即可）。

### 交易（Transaction）邊界

跨兩個資料庫的操作**無法用單一 `@Transactional` 保護**。若需要跨庫一致性（例如 wallet-service 同時寫 PostgreSQL 和 MySQL），應採用：

1. **雙寫策略**：先寫主庫，成功後再寫讀庫（讀庫寫失敗可補寫）
2. **Kafka 事件驅動**：主庫寫完後發 Kafka 事件，由消費者同步到讀庫

### 本機連線確認

啟動服務前確認 Docker 容器已啟動：

```bash
# 確認兩個資料庫都在線
docker ps | grep -E "mysql|postgres"

# 測試連線
docker exec -it lucky_mysql mysql -u lucky_user -plucky_password lucky_star_casino -e "SELECT 1"
docker exec -it lucky_postgres psql -U lucky_user -d lucky_star_casino -c "SELECT 1"
```
