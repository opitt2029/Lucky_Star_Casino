# 雙 DataSource 使用指南

> 適用服務：`wallet-service`、`admin-service`  
> 架構依據：[ADR-001 資料庫分配決策](adr/ADR-001.md)  
> 最後校對：2026-07-13（**依實際程式碼重寫**，原版把次庫寫成「用 JdbcTemplate 即可」，與現況不符）

---

## 為什麼需要雙 DataSource？

依照 ADR-001 的 CQRS 設計，這兩個服務各自同時連接兩個資料庫：

| 服務 | 主源（`@Primary`） | 次源 |
|------|-----------------|------|
| `wallet-service` | PostgreSQL 5433（帳務寫庫） | MySQL 3307（讀視圖、商城目錄、鑽石卡） |
| `admin-service`  | **MySQL** 3307（會員/目錄/點數卡查詢） | PostgreSQL 5433（`admin_users`、`admin_alerts`、`admin_action_logs`、報表讀帳務） |

> ⚠️ 兩個服務的主源**方向相反**：wallet 以 PostgreSQL 為主、admin 以 **MySQL** 為主
> （見各自的 `config/DataSourceConfig.java`）。別把其中一個的假設套到另一個上。

---

## ⚠️ 最重要的一點：`spring.jpa.*` 對這兩個服務無效

Spring Boot 的 JPA 自動配置只會替 `spring.datasource` 建一套
`DataSource` / `EntityManagerFactory` / `TransactionManager`。雙資料源要兩套，
所以這兩個服務**把三種 Bean 全部手動建立**（`config/DataSourceConfig.java`），
自動配置那條路整個被繞開。

`wallet-service` 實際建立的 Bean（`DataSourceConfig.java`）：

| Bean | PostgreSQL | MySQL |
|---|---|---|
| DataSource | `postgresDataSource` | `mysqlDataSource` |
| EntityManagerFactory | `postgresEntityManagerFactory` | `mysqlEntityManagerFactory` |
| TransactionManager | `postgresTransactionManager` | `mysqlTransactionManager` |

**兩邊都是 JPA**，不是「主庫 JPA、次庫 JdbcTemplate」。
`admin-service` 同理（另有 `PostgresJpaConfig` 專門管次源的 JPA 設定）。

由此衍生三條實務規則：

1. **entity / repository 必須放對套件**。EMF 各自只掃自己的 package
   （wallet：`com.luckystar.wallet.postgres.*` vs `com.luckystar.wallet.mysql.*`）。
   放錯套件＝該 EMF 掃不到，啟動時報 "Not a managed type"。
2. **`@Transactional` 一定要指定 transactionManager**，例如
   `@Transactional(transactionManager = "postgresTransactionManager")`。不指定會拿到
   容器裡「某一個」manager，行為不可預期。
3. **`JPA_DDL_AUTO` 預設是 `validate`**（schema 由 `database/*/init.sql` + migration 管）。
   新增 entity 欄位卻沒改 SQL → 服務**啟動就失敗**，連帶把既有功能一起弄掛。

---

## 套件配置（wallet-service 實際結構）

```
com.luckystar.wallet
├── config/DataSourceConfig.java     ← 兩套 DataSource / EMF / TxManager 都在這
├── postgres/
│   ├── entity/      Wallet, WalletTransaction, DiamondWallet, ShopRedemption, TopupOrder, DeadLetterMessage
│   └── repository/  WalletRepository, WalletTransactionRepository, ...
└── mysql/
    ├── entity/      WalletTransactionView, GiftLog, DiamondCard, ShopItem
    └── repository/  WalletTransactionViewRepository, GiftLogRepository, ShopItemRepository, ...
```

**放對套件就會自動接上對應的 EMF**——`postgres.*` 由 `postgresEntityManagerFactory` 掃、
`mysql.*` 由 `mysqlEntityManagerFactory` 掃。兩邊都是普通的 Spring Data JPA `Repository` 介面。

---

## 寫法範例（皆取自實際程式碼）

### 走 PostgreSQL 主源：帳務扣款

```java
@Service
public class DiamondWalletService {

    @Transactional(transactionManager = "postgresTransactionManager")
    public ... redeem(...) { ... }
}
```

帳務核心（`WalletService.debit()/credit()`）同樣指定 `postgresTransactionManager`，
並靠 `wallets.version` 樂觀鎖 + `wallet_transactions.idempotency_key` UNIQUE 保證正確性。

### 走 MySQL 次源：讀目錄 / 點數卡

```java
@Service
public class DiamondCardService {

    @Transactional(transactionManager = "mysqlTransactionManager")
    public ... markRedeemed(...) { ... }
}
```

---

## ⚠️ 陷阱：跨庫操作必須拆成兩個 Bean

同一個類別裡「先讀 MySQL 目錄、再寫 PostgreSQL 帳務」看起來很自然，但**做不到**：
`@Transactional` 是靠 Spring AOP proxy 生效的，**類別內部的自我呼叫不會經過 proxy**，
指定的 `mysqlTransactionManager` 根本不會套用。

所以專案的作法是**把次源存取拆成獨立的 Bean 再注入**，例如：

- `DiamondCardService`（MySQL）／`GiftLogService`（MySQL）／`ShopCatalogService`（MySQL 讀目錄）
- 由 `DiamondExchangeService`、`ShopRedeemService` 等 PostgreSQL 交易方法注入使用

這些類別的 Javadoc 都明寫了理由：*「獨立成 bean 是為了讓
`@Transactional(mysqlTransactionManager)` proxy 生效」*。新增跨庫功能請比照辦理，
**不要把 MySQL 查詢合併進 PostgreSQL 的 `@Transactional` 方法裡**。

---

## 交易邊界：跨兩個資料庫沒有單一交易

跨庫操作**無法用一個 `@Transactional` 保護**（沒有引入 XA / 2PC）。專案採用：

1. **Kafka 事件驅動同步讀庫**：PostgreSQL 寫入後發 `wallet.credit`/`wallet.debit` 事件，
   `WalletReadSyncListener` 消費後寫 MySQL 讀視圖，並用 `existsById` 做冪等檢查。
2. **原子性優先放在帳務庫**：例如商城兌換＝「`debit(SHOP_PURCHASE)` + 寫 `shop_redemptions`」
   在**同一個 PostgreSQL 交易**內完成；MySQL 那邊只是讀目錄。
3. **失敗補償**：game→wallet 的 credit 失敗落補償單、以相同冪等鍵重試（ADR-009）。

---

## 測試

- 日常 `mvn test` 一律 **H2 記憶體 DB**，零外部依賴。wallet 因雙資料源，surefire 另設
  `jpa.ddl-auto=create`。
- **例外（ADR-007）**：wallet-service 另有 `@Tag("containers")` 的 Testcontainers 真 DB 測試
  （`containers/` 套件，postgres:16 + mysql:8.4 套真 schema、`ddl-auto=validate`），
  surefire 預設排除，要跑得下：

  ```bash
  mvn -pl backend/wallet-service test -Pcontainers-test
  ```

  本機需 Docker；Windows 另需 `$env:DOCKER_HOST='npipe:////./pipe/dockerDesktopLinuxEngine'`。
  它守的正是 H2 測不到的東西：**entity 與真 schema 的漂移**。

---

## 本機連線確認

```bash
# 確認兩個資料庫都在線（容器名見 docker-compose.yml）
docker ps --filter name=lucky-star

# 測試連線（帳密用你 .env 裡自己生成的值）
docker exec -it lucky-star-mysql mysql -u lucky_user -p lucky_star_casino -e "SELECT 1"
docker exec -it lucky-star-postgres psql -U lucky_user -d lucky_star_casino -c "SELECT 1"
```
