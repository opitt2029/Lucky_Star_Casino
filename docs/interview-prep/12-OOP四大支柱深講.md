# OOP 四大支柱深講 — 用 Lucky Star Casino 專案講故事

> 目標：面試被問「講一個你專案裡的封裝/繼承/多型/抽象範例」時，不要愣住。
> 每個支柱都配「白話解釋 / 專案實例 / 為什麼這樣設計 / 可能被追問什麼」四段式。
> 程式碼位置皆為 repo 相對路徑，方便你面試前重新打開檔案複習。

---

## 0. 一句話總覽（先背起來）

| 支柱 | 一句話 | 專案代表範例 |
|---|---|---|
| 封裝 Encapsulation | 把「資料」跟「怎麼改資料的規則」包在一起，外部只能透過方法動它 | `Wallet` entity + `WalletService.credit()/debit()` |
| 繼承 Inheritance | 子類複用父類的欄位/方法，只加或覆寫差異部分 | 20+ 個 `XxxException extends RuntimeException` |
| 多型 Polymorphism | 同一個呼叫介面，執行期依實際型別跑出不同行為 | `GlobalExceptionHandler` 的 `@ExceptionHandler` 分派、`JpaRepository` 動態代理 |
| 抽象 Abstraction | 只暴露「做什麼」，藏起「怎麼做」的細節 | `SlotSymbol.fromWeightedIndex()` 藏加權演算法 |

---

## 1. 封裝（Encapsulation）

### 1.1 白話解釋
封裝不是「欄位加 private」這麼膚淺。核心精神是：**物件對外只承諾行為（方法），不承諾資料怎麼存、怎麼變**。呼叫方不需要、也不應該知道內部細節，只要呼叫方法就能得到正確結果，而且物件自己保證「不會被改壞」。

新手常見誤解：以為 `@Getter`/`@Setter` 全開就是封裝。事實上**開放 setter 給外部隨意改帳務欄位，等於沒封裝**——因為「改資料的規則」（樂觀鎖、餘額不可為負、必須記交易明細）全部繞過去了。

### 1.2 專案實例：`Wallet` entity + `WalletService`

**檔案**：`backend/wallet-service/src/main/java/com/luckystar/wallet/postgres/entity/Wallet.java`

```java
@Entity
@Table(name = "wallets")
@Getter
@Setter
public class Wallet {
    @Id
    @Column(name = "player_id")
    private Long playerId;

    @Column(name = "balance", nullable = false)
    private Long balance = 0L;

    @Version                      // 樂觀鎖版本號，外部絕對不該手動設
    @Column(name = "version", nullable = false)
    private Long version;

    @PrePersist
    void prePersist() { ... }     // 自己管時間戳，外部插不了手

    @PreUpdate
    void preUpdate() { ... }
}
```

真正的「封裝邊界」不是這個 entity class，而是它外面那層 `WalletService`：

- 呼叫方**不會**直接 `wallet.setBalance(wallet.getBalance() + 100)` 然後存檔——這樣沒有冪等檢查、沒有交易明細、沒有樂觀鎖重試。
- 呼叫方只能呼叫 `WalletService.credit(playerId, amount, idempotencyKey, subType)`，內部固定流程：
  1. 查 `idempotency_key` 是否已處理過（防重複）
  2. 讀 wallet（帶 `@Version`）
  3. 改 `balance`
  4. 存檔（`@Version` 不符就丟 `ObjectOptimisticLockingFailureException`，上層重試）
  5. 寫一筆 `wallet_transactions` 記錄

外部完全不知道「樂觀鎖重試幾次」「冪等鍵怎麼查」這些細節——**這才是封裝真正保護的東西：業務不變量（invariant）**，不是欄位的 private 關鍵字。

### 1.3 為什麼這樣設計
- **防超扣**：如果 `balance` 隨便誰都能改，兩個併發請求可能都讀到舊值、都扣款成功，餘額變負數。封裝把「讀-改-存」這個原子操作鎖在 `WalletService` 內部，搭配 `@Version` 樂觀鎖，外部無法繞過。
- **防重複扣款**：`idempotency_key` 的檢查邏輯只存在於 service 內，呼叫方（game-service）不需要、也不被允許知道要怎麼防重放，只要每次呼叫帶一個唯一鍵即可。
- 對照 AGENTS.md 雷區 8：「帳務操作=冪等 + 樂觀鎖」，這正是封裝把這條規則鎖進單一入口的具體實現。

### 1.4 可能被追問
- **Q：Lombok 全開 `@Getter @Setter` 不就破壞封裝了？**
  A：對 entity 本身確實是「弱封裝」，因為 JPA/Builder 需要這些存取器。但真正的封裝邊界拉到 service 層——entity 是資料容器（DTO-like），業務規則跟不變量的守門在 `WalletService`。這是分層架構常見的取捨：entity 給框架用，service 給業務邏輯守門。
- **Q：如果要做「更嚴格」的封裝，你會怎麼改？**
  A：可以把 `setBalance` 拿掉，改成只給 `applyDelta(long delta)` 這種語意方法，甚至把 entity 建構子限制成只能透過 factory method 建立，杜絕外部用 `new Wallet()` + setter 拼出不合法狀態。

---

## 2. 繼承（Inheritance）

### 2.1 白話解釋
繼承讓子類「免費」拿到父類的欄位跟方法，只需要寫「差異的部分」。用對的地方：子類跟父類是「is-a」關係，且子類真的需要複用父類邏輯，而不是只是「兩個東西剛好長得像」。

新手常見誤解：看到兩個 class 有共同欄位就繼承。其實**組合（has-a）通常比繼承（is-a）更安全**，繼承是本專案裡刻意「用得少、用得準」的工具。

### 2.2 專案實例 A：例外體系（最大量、最典型）

**檔案**：`backend/wallet-service/src/main/java/com/luckystar/wallet/exception/*.java`（20+ 個檔案）

```java
public class InsufficientBalanceException extends RuntimeException {
    public InsufficientBalanceException(String message) {
        super(message);
    }
}

public class WalletNotFoundException extends RuntimeException {
    public WalletNotFoundException(String message) {
        super(message);
    }
}
// ... CardAlreadyRedeemedException、GiftLimitExceededException、
//     IllegalDltStateException、ShopItemUnavailableException ... 同構
```

每個服務（wallet/member/game/admin）都各自有一批 `XxxException extends RuntimeException`：
- 全部複用 `RuntimeException` 的堆疊追蹤、`getMessage()`、unchecked（不強迫呼叫端 try-catch）的特性
- 子類只加「語意化的名字」，讓 `catch (InsufficientBalanceException e)` 比 `catch (RuntimeException e)` 精確、比字串比對訊息內容可靠

### 2.3 專案實例 B：測試基底類

**檔案**：`backend/wallet-service/src/test/java/com/luckystar/wallet/containers/AbstractDualDatasourceContainerTest.java`

```java
public abstract class AbstractDualDatasourceContainerTest {
    // 共用：啟動 postgres:16 + mysql:8.4 Testcontainers、
    // 套真實 schema、雙資料源連線設定
}

public class WalletOptimisticLockContainerTest
        extends AbstractDualDatasourceContainerTest {
    // 只寫「樂觀鎖」這個測項專屬的測試方法
}
```

這是繼承用在「消除重複」的教科書案例：容器啟動、schema 套用、雙資料源設定這些**每個 container 測試都要做的事**寫一次在 abstract class，具體測試類別繼承後只專注自己的斷言。

### 2.4 為什麼這樣設計
- 例外體系：如果不用繼承，每個地方都要 `new RuntimeException("餘額不足")`，`GlobalExceptionHandler` 就只能靠比對字串內容分派 HTTP 狀態碼——又醜又脆弱。用繼承讓**型別本身就是語意**，`@ExceptionHandler(InsufficientBalanceException.class)` 直接依 class 分派（這段接到下面「多型」）。
- 測試基底類：Testcontainers 啟動成本高（真的拉 Docker image），共用邏輯若複製貼上四份，改一次 schema 要改四個地方；繼承讓「共用設置」只維護一份。

### 2.5 可能被追問
- **Q：例外都繼承 `RuntimeException` 而不是 `Exception`，差在哪？為什麼這樣選？**
  A：`Exception`（checked）強迫呼叫端 `throws` 宣告或 try-catch，`RuntimeException`（unchecked）不用。專案選 unchecked，是因為這些例外本質是「業務規則失敗」，用 `@RestControllerAdvice` 全域攔截轉成 HTTP 狀態碼即可，不需要在每層方法簽名上疊 `throws`，減少樣板碼。
- **Q：繼承鏈太深會有什麼問題？**
  A：脆弱基底類問題（fragile base class）——改父類的方法，所有子類行為跟著變、卻不一定符合子類原意；還有「菱形繼承」在多重繼承語言會有歧義（Java 用 interface 的 default method 解這個）。本專案的繼承刻意維持扁平（都只有一層），沒有這個風險。
- **Q：什麼情況你會選組合而不是繼承？**
  A：兩個 class 只是「剛好有相同欄位」但語意上不是 is-a 關係，例如 `SlotService` 跟 `BaccaratService` 都要呼叫 wallet，但它們不是「同一種東西的子類型」，所以是各自持有一個 `WalletClient`（組合），而不是共同繼承一個 `AbstractGameService`。

---

## 3. 多型（Polymorphism）

### 3.1 白話解釋
多型：**同一個呼叫方式，因為實際物件型別不同，跑出不同行為**。兩種常見形式：
1. **編譯期多型（overload）**：同名方法、不同參數簽名，編譯器依參數型別決定呼叫哪個。
2. **執行期多型（override / 動態綁定）**：呼叫端只認父類/介面型別，實際執行時依物件的真實型別動態決定要跑哪段程式碼。專案裡的例子偏這一種。

### 3.2 專案實例 A：`GlobalExceptionHandler` 的分派

**檔案**：`backend/wallet-service/src/main/java/com/luckystar/wallet/exception/GlobalExceptionHandler.java`

```java
@ExceptionHandler(WalletNotFoundException.class)
@ResponseStatus(HttpStatus.NOT_FOUND)
public ApiResponse<Void> handleWalletNotFound(WalletNotFoundException ex) {
    return ApiResponse.error(ex.getMessage());
}

@ExceptionHandler(InsufficientBalanceException.class)
@ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
public ApiResponse<Void> handleInsufficientBalance(InsufficientBalanceException ex) {
    return ApiResponse.error(ex.getMessage());
}
// ... 十幾個同構的 handler
```

Controller 層完全不用寫任何 try-catch，也不用管丟出來的是哪一種例外。Spring 在攔截到例外時，依「丟出來的物件的實際型別」去比對 `@ExceptionHandler` 註記的 class，動態選中對應方法執行——**呼叫端寫死一種行為（拋例外），實際處理行為隨例外的真實型別而變**，這是「執行期多型」在框架層的體現（雖然不是你自己寫 `override`，但底層機制是同一件事：依實際型別動態決定行為）。

### 3.3 專案實例 B：`JpaRepository` 介面 + 動態代理

**檔案**：`backend/wallet-service/src/main/java/com/luckystar/wallet/postgres/repository/WalletRepository.java`

```java
public interface WalletRepository extends JpaRepository<Wallet, Long> {
}
```

這一個檔案只有兩行，卻是最容易被面試官深挖的多型範例：
- 全專案任何一個 `@Service` 只認得 `WalletRepository` 這個**介面型別**，呼叫 `save()`、`findById()`。
- 但介面沒有實作！執行期 Spring Data JPA 用 **JDK 動態代理（Dynamic Proxy）** 在啟動時生成一個實作類別，把每個方法呼叫轉譯成 SQL 執行。
- 呼叫端完全不知道、也不需要知道底層是代理類別——**面向介面編程（program to interface）** 讓實作可以整個替換掉（例如換成別的 ORM）都不影響呼叫端一行程式碼。

### 3.4 為什麼這樣設計
- `GlobalExceptionHandler` 的多型分派讓「錯誤處理邏輯」跟「業務邏輯」完全分離——`WalletService.debit()` 只管丟語意例外，完全不管 HTTP 狀態碼怎麼決定，職責單一。
- Repository 介面的多型讓資料存取層可測試（單元測試可以 mock 介面，不用啟資料庫）、可替換（H2/PostgreSQL/MySQL 切換不影響 service 層程式碼）。

### 3.5 可能被追問
- **Q：`@ExceptionHandler` 這種算不算「真正的」OOP 多型？跟 Java 的 `override` 不一樣吧？**
  A：機制不同（一個是 Spring 內部用反射/型別比對做 dispatch table，一個是 JVM 的 vtable 動態綁定），但**行為模式相同**：呼叫端不用 if-else 判斷型別，系統依實際型別自動選擇對應行為。面試時可以誠實講清楚「這是框架層面的多型分派，不是我自己寫 override」，展現你懂機制差異，不會只是背名詞。
- **Q：舉一個你自己寫 `override` 達成多型的例子？**
  A：本專案目前商業邏輯層較少手寫 `extends` + `override`（多用組合/介面），如果要現場延伸，可以講：如果要讓 `SlotService`、`BaccaratService`、`FishingService` 有共同的「結算後補償重試」邏輯，同時各自有不同的派彩計算，可以定義一個 `abstract class GameSettlementTemplate` 用**樣板方法模式（Template Method Pattern）**——父類定固定流程（呼叫 wallet → 失敗記補償單 → 成功發事件），子類只 `override` 派彩計算那一步。這是可以主動聊的「如果要重構會怎麼加多型」的加分題。

---

## 4. 抽象（Abstraction）

### 4.1 白話解釋
抽象：**只暴露「做什麼」的介面，藏起「怎麼做」的實作細節**。跟封裝常被搞混，差異是：
- 封裝關心「資料安全」（誰能改狀態）
- 抽象關心「介面簡潔」（呼叫方要不要懂實作邏輯）

一個物件可以封裝良好但完全不抽象（例如把所有計算步驟都暴露成 public 方法讓外部一步步呼叫），也可以抽象良好但封裝很差（例如介面很乾淨，但內部欄位隨便誰都能改）。兩者是正交的概念。

### 4.2 專案實例：`SlotSymbol.fromWeightedIndex()`

**檔案**：`backend/game-service/src/main/java/com/luckystar/game/slot/SlotSymbol.java`

```java
public enum SlotSymbol {
    CHERRY(45, 1, 5, 0x1F352),
    LEMON(30, 1, 8, 0x1F34B),
    BELL(16, 2, 18, 0x1F514),
    STAR(7, 3, 50, 0x2B50),
    SEVEN(5, 5, 70, 0x0037, 0xFE0F, 0x20E3);

    public static final int TOTAL_WEIGHT = computeTotalWeight();

    public static SlotSymbol fromWeightedIndex(int index) {
        if (index < 0 || index >= TOTAL_WEIGHT) {
            throw new IllegalArgumentException(...);
        }
        int cursor = index;
        for (SlotSymbol symbol : values()) {
            if (cursor < symbol.weight) {
                return symbol;
            }
            cursor -= symbol.weight;
        }
        throw new IllegalStateException(...);
    }
}
```

呼叫端（`SlotMachine` 開獎邏輯）只做兩件事：
1. 產生 `[0, TOTAL_WEIGHT)` 的隨機數
2. 呼叫 `SlotSymbol.fromWeightedIndex(index)`

呼叫端**完全不需要知道**：
- 累積區間怎麼算（`cursor -= symbol.weight` 這個迴圈）
- 五種符號各自的權重是多少
- 權重總和是怎麼來的（`computeTotalWeight()`）

這就是抽象：把「加權隨機抽樣」這個有演算法複雜度的問題，包成一個一行呼叫就能用的靜態方法。**改權重數字（例如砍 CHERRY 從 45 改 40）完全不影響呼叫端一行程式碼**——這是抽象帶來的「可維護性」紅利。

### 4.3 專案實例：抽象在架構層級的體現——分層本身就是抽象

- Controller 不知道 Service 怎麼查資料庫
- Service 不知道 Repository 底層是 JPA 還是 JDBC
- game-service 呼叫 wallet 的 `debit()` 完全不知道對方內部有沒有做樂觀鎖重試、重試幾次

這是「抽象」在整個微服務架構的縮影：**每一層只認介面契約，不認實作細節**。AGENTS.md 雷區 22 提到的 `WalletCompensationService`（credit 失敗補償）也是一例：game-service 呼叫 wallet 只知道「呼叫失敗要記補償單重試」，完全不用管 wallet 內部帳務怎麼記。

### 4.4 為什麼這樣設計
- 降低認知負擔：呼叫端不用背誦加權演算法就能正確使用
- 降低耦合：內部實作（權重數字、演算法細節）改動不影響外部呼叫者
- 對照 AGENTS.md 雷區 15：「改老虎機權重要同步改測試」——正因為抽象把權重邏輯封在 enum 內部，外部呼叫端完全不用動，**只要改 `SlotSymbol` 建構子的數字**，這正是良好抽象的證明（影響範圍被限縮到單一檔案）

### 4.5 可能被追問
- **Q：enum 跟 interface/abstract class 都能做抽象，這裡為什麼選 enum？**
  A：符號集合是**固定、封閉、有限**的（就 5 種），enum 天生保證型別安全（不會有人傳一個不存在的符號）、`values()` 可遍歷、每個實例自帶不可變資料（weight/multiplier）。如果符號種類未來會動態擴充（例如靠設定檔加新符號），才會考慮用 interface + 實作類的抽象方式。
- **Q：抽象跟封裝要怎麼在面試講清楚差異，不要混為一談？**
  A：可以這樣分：「封裝保護的是『資料的正確性』（不讓外部把物件改壞），抽象簡化的是『介面的複雜度』（不讓外部知道太多不必要的細節）。`SlotSymbol.fromWeightedIndex()` 主要展現抽象——演算法藏起來；`Wallet` + `WalletService` 主要展現封裝——防止外部繞過樂觀鎖亂改餘額。」

---

## 5. 綜合：一分鐘總結稿（背起來直接講）

> 「我們專案裡四個 OOP 概念都有具體對應：**封裝**是 `Wallet` entity 搭配 `WalletService`，外部只能透過 `credit`/`debit` 方法動餘額，內部自己管樂觀鎖跟冪等；**繼承**是我們 20 幾個自訂例外都繼承 `RuntimeException`，共用堆疊追蹤機制只加語意名稱；**多型**最明顯的是 `GlobalExceptionHandler`，用 `@ExceptionHandler` 依例外的實際型別動態分派到不同的 HTTP 狀態碼處理，Controller 完全不用寫 try-catch；**抽象**是老虎機的 `SlotSymbol.fromWeightedIndex()`，把加權隨機抽樣的演算法藏在 enum 內部，呼叫端只要傳一個隨機索引就好，完全不用懂內部怎麼算累積區間。」

---

## 6. 加分延伸：如果面試官問「你們專案有沒有用到設計模式？」

雖然不是嚴格的「四大支柱」，但可以順勢帶出（展現你懂得更多，不會被問倒）：

- **策略模式（Strategy）**：`RiskControlService` 的 `risk.global-rtp-limit` 是 per-game 的 map（雷區 17），概念上每個遊戲一套風控策略，只是目前用 config map 而非 class 多型實作——可以誠實講「現在是用資料驅動的方式做到策略模式的效果，沒有另外拆 class」。
- **樣板方法模式（Template Method）**：見 §3.5 的延伸回答，`WalletCompensationRetryJob` 對所有遊戲統一的「失敗記單 → 排程重試」流程，就是樣板方法的精神（固定骨架、各遊戲填自己的派彩計算）。
- **職責鏈/攔截器模式（Chain of Responsibility）**：gateway 的 filter 鏈（`JwtAuthenticationGlobalFilter` → `PlayerRateLimitGlobalFilter` → `GameConcurrencyLimitGlobalFilter`）依序處理請求，每個 filter 只管自己那一段，不通過就短路——這是 Spring Cloud Gateway 內建的職責鏈設計。

這段可以在被問完四大支柱後主動加一句：「如果要再往下延伸，我們 gateway 的 filter 鏈其實是職責鏈模式的實例……」展現你能舉一反三，不是死背名詞。
