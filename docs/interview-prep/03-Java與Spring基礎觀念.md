# 03 — Java 與 Spring 基礎觀念（綁專案實例）

> 台灣後端面試的「基本功」題。每個觀念盡量配一個本專案的實際出現點，讓你能從「我專案哪裡用到」切入，比純背定義更有說服力。

---

## 1. JVM 與記憶體

### 1.1 JVM 記憶體區域
- **Heap（堆）**：物件實例存放處，GC 主戰場。分新生代（Eden + 2×Survivor）與老年代。
- **Stack（虛擬機堆疊）**：每個執行緒一份，存方法的區域變數、操作數堆疊、方法呼叫框（frame）。
- **Metaspace（元空間，Java 8+ 取代 PermGen）**：類別中繼資料，用本機記憶體。
- **PC Register、Native Method Stack**：程式計數器與原生方法堆疊。
- **面試切入**：「我的 wallet-service 是長時間運行的帳務服務，所以我會在意 heap 大小與 GC 停頓——帳務 API 要低延遲，Full GC 的 STW 會讓扣款請求卡住。」

### 1.2 GC（垃圾回收）
- **可達性分析**：從 GC Roots（堆疊區域變數、靜態變數、JNI 引用等）出發，不可達的物件才回收（不是引用計數，能解循環引用）。
- **分代回收**：大多數物件朝生夕死 → 新生代用複製演算法（Minor GC，快）；存活久的進老年代 → 標記-整理（Major/Full GC，慢，會 STW）。
- **常見收集器**：G1（Java 9+ 預設，可預測停頓）、ZGC/Shenandoah（超低停頓，適合大 heap 低延遲）。
- **面試切入**：「帳務服務我會傾向 G1 或 ZGC 壓低停頓；高頻交易服務最怕長 STW。」
- **STW（Stop The World）**：GC 某些階段要暫停所有應用執行緒，這就是延遲尖刺來源。

### 1.3 記憶體洩漏（Java 也會有）
- 長生命週期集合持有短生命週期物件（如靜態 Map 一直 put 不 remove）、ThreadLocal 沒 remove、監聽器沒移除。
- 本專案相關：Redis session、ZSet 排行榜都設 **TTL**，就是避免「資料無限堆積」的營運版記憶體管理思維。

---

## 2. 集合（Collections）

### 2.1 HashMap 原理
- **結構**：陣列 + 連結串列，JDK 8 起當單一 bucket 長度 > 8 且陣列長度 ≥ 64 時，連結串列轉**紅黑樹**（O(n)→O(log n)），退化回 6 時轉回。
- **hash 擾動**：`(h = key.hashCode()) ^ (h >>> 16)`，把高位混入低位，減少碰撞。
- **擴容（resize）**：負載因子預設 0.75，元素數 > 容量×0.75 時容量翻倍，重新分配 bucket。**擴容是昂貴操作**，已知大小要在建構時給初始容量。
- **執行緒不安全**：多執行緒同時 put 可能丟資料；JDK 7 並發擴容會成環（CPU 100%），JDK 8 修了成環但仍不安全。
- **本專案實例**：`FishingSessionStore` 用 `HashMap` 模擬 Redis Hash 做測試替身（`toHash()`/`fromHash()`）。

### 2.2 ConcurrentHashMap
- JDK 8 用 **CAS + synchronized 鎖單一 bucket 頭節點**（取代 JDK 7 的 Segment 分段鎖），併發度更高。
- 讀不加鎖（`Node` 的 `val`/`next` 用 `volatile`）。
- **面試**：「要執行緒安全的 Map 用 `ConcurrentHashMap`，不要用 `Collections.synchronizedMap`（整個鎖、併發差）也不要用 `Hashtable`（過時、全表鎖）。」

### 2.3 ArrayList vs LinkedList
- ArrayList：陣列，隨機存取 O(1)、中間增刪 O(n)、有擴容。
- LinkedList：雙向鏈，增刪 O(1)（拿到節點時）、隨機存取 O(n)。實務上 ArrayList 幾乎總是贏（CPU cache 友善）。

---

## 3. 並發（Concurrency）★高頻

### 3.1 樂觀鎖 vs 悲觀鎖（一定會問，且能接專案）
- **悲觀鎖**：假設一定會衝突，先鎖再動。DB 的 `SELECT ... FOR UPDATE`、Java 的 `synchronized`/`ReentrantLock`。
- **樂觀鎖**：假設很少衝突，不鎖，更新時檢查版本，衝突了再重試。DB 的版本欄位、Java 的 CAS。
- **本專案**：`Wallet.java` 的 `@Version` 就是樂觀鎖。下注扣款用樂觀鎖，因為同一玩家同時多筆下注罕見、衝突率低，不鎖列吞吐高；衝突就 409 重試。**這題一定接到決策 1。**

### 3.2 synchronized vs Lock
- `synchronized`：JVM 內建、自動釋放、JDK 6 後有偏向鎖/輕量鎖優化；不可中斷、不可設超時。
- `ReentrantLock`：手動 lock/unlock（要 `finally` 釋放）、可中斷、可超時、可公平鎖、可搭配 `Condition`。
- 選擇：簡單同步用 `synchronized`，要進階控制用 `Lock`。

### 3.3 volatile
- 保證**可見性**（一個執行緒改了別的執行緒立刻看得到）和**禁止指令重排**，但**不保證原子性**（`i++` 仍不安全）。
- 經典用途：double-checked locking 的單例、狀態旗標。`ConcurrentHashMap` 的節點值就是 volatile。

### 3.4 執行緒池（ThreadPoolExecutor）
- 核心參數：`corePoolSize`、`maximumPoolSize`、`keepAliveTime`、`workQueue`、`RejectedExecutionHandler`。
- **為什麼用池**：執行緒建立/銷毀昂貴、無限制建執行緒會 OOM。池化復用、削峰、控制併發量。
- 不要直接用 `Executors.newFixedThreadPool`（無界佇列會 OOM），實務手動 `new ThreadPoolExecutor` 給有界佇列 + 拒絕策略。

### 3.5 CAS 與 ABA
- CAS（Compare-And-Swap）：CPU 原子指令，`AtomicInteger` 等的底層。樂觀鎖的本質。
- ABA 問題：值從 A→B→A，CAS 以為沒變。解法：加版本號（`AtomicStampedReference`）——和 `@Version` 思路一致。

### 3.6 Java 21 虛擬執行緒（Virtual Threads / Project Loom）
- 輕量級執行緒，由 JVM 排程到少量平台執行緒上，適合**高併發 I/O 阻塞**場景（一個請求一條虛擬執行緒，不怕阻塞）。
- 本專案是 Java 21，可講「如果 game→wallet 的同步 REST 呼叫量很大，虛擬執行緒能用同步寫法拿到接近非同步的吞吐」。

---

## 4. Spring 核心

### 4.1 IoC / DI（控制反轉 / 依賴注入）
- **IoC**：物件的建立與相依關係交給容器管理，不自己 `new`。
- **DI 三種注入**：建構子（推薦，可 final、好測試、避免循環依賴在啟動就爆）、setter、欄位（`@Autowired`，不推薦，難測試）。
- **本專案**：`WalletService` 用 Lombok `@RequiredArgsConstructor` 做建構子注入（`final` 欄位 walletRepository、kafkaTemplate…）。

### 4.2 Bean 生命週期與作用域
- 流程：實例化 → 屬性注入 → `BeanNameAware` 等 Aware → `BeanPostProcessor.before` → `@PostConstruct`/`InitializingBean` → `BeanPostProcessor.after`（AOP 代理在此包） → 使用 → `@PreDestroy`。
- Scope：`singleton`（預設，容器內單例）、`prototype`、web 的 `request`/`session`。

### 4.3 @Transactional 原理與失效情境 ★高頻陷阱
- **原理**：基於 AOP 動態代理。呼叫被代理的方法時，代理在前後開/提交/回滾交易。
- **失效情境（面試最愛考）**：
  1. **self-invocation（自我呼叫）**：同類別內 A 方法呼叫本類別的 B 方法（`this.b()`），不經過代理 → B 的 `@Transactional` 失效。**本專案實例**：禮品商城的 `ShopCatalogService` 被刻意拆成獨立服務（用 `mysqlTransactionManager`），就是因為「跨資料源讀目錄」若合併進同一個 PostgreSQL 交易方法、用 `this` 自我呼叫，`@Transactional` 會失效。
  2. 方法非 `public`、被 `final`/`static`。
  3. 異常被自己 catch 沒往外拋（交易不會回滾）。
  4. 預設只對 `RuntimeException`/`Error` 回滾，checked exception 不回滾（要 `rollbackFor`）。
- **多 TransactionManager**：本專案有 postgres/mysql 兩個，`@Transactional` 要指定 `transactionManager`（見決策 2）。

### 4.4 Spring Boot 自動配置
- `@SpringBootApplication` = `@Configuration` + `@EnableAutoConfiguration` + `@ComponentScan`。
- 自動配置靠 `spring.factories`/`AutoConfiguration.imports` + 條件註解（`@ConditionalOnClass`、`@ConditionalOnMissingBean`）。
- **本專案陷阱**：多資料源時自動配置失效，要手動配（決策 2）；Spring Boot 3.2+ **禁止同名 `@Bean` 方法**（`enforceUniqueMethods`），重複會啟動就丟 `BeanDefinitionParsingException`。

### 4.5 Spring Security（簡述）
- Filter chain 模型；本專案認證主力在 gateway 的全域 filter，member/admin 用 Security + JWT filter。
- 密碼用 **BCrypt**（加鹽、慢雜湊，抗暴力破解）——`AuthService` 驗密用 BCrypt。

---

## 5. JPA / Hibernate

- **一級快取（持久化上下文）**：同一交易內查同一實體只打一次 DB，後續從 session 拿。
- **N+1 問題**：查 1 個列表再對每筆查關聯 → 1+N 次查詢。解法：`JOIN FETCH`、`@EntityGraph`、批次抓取。
- **`@Version` 樂觀鎖**：見並發章節，本專案 `Wallet`/`friendships` 都有。
- **dialect（方言）**：Hibernate 依資料庫產不同 SQL。本專案 `DataSourceConfig` 用 system property 切換正式（PostgreSQL/MySQL Dialect）與測試（H2Dialect），讓測試不連外部 DB。
- **`saveAndFlush` vs `save`**：`save` 可能延到交易提交才寫；要立刻觸發 DB 約束（如測並發建錢包）用 `saveAndFlush`（見 `WalletService.createWallet`）。

---

## 6. Java 語言特性（Java 17/21）

- **record**：不可變資料載體，自動產 constructor/getter/equals/hashCode。本專案 Kafka 事件如 `WalletCreditEvent`、`WalletCreditRequestEvent` 都是 record——很適合「不可變的事件物件」。
- **sealed class/interface**：限制可被哪些類別繼承/實作，配 pattern matching 做窮舉。
- **switch pattern matching、文字區塊（text block）**：Java 17+ 語法糖。
- **Optional**：表達「可能沒有」，本專案 `walletTransactionRepository.findByIdempotencyKey(...)` 回 `Optional`，冪等檢查用 `isPresent()`。避免拿 Optional 當欄位、別 `.get()` 不檢查。

---

## 7. JVM 深入補充（搭配 `07` 脈絡 I）

### 7.1 GC 的三色標記與「漏標」
併發標記時，GC 把物件分三色：**白（待回收）/灰（已標記但引用未掃完）/黑（完全掃完）**。問題是「應用執行緒一邊改引用、GC 一邊掃」，可能把一個本來該存活的白物件漏掉（黑物件新增了指向白物件的引用，而白物件原本的引用被刪）。兩種補救：
- **CMS：增量更新（incremental update）**——記錄「黑物件新增指向白物件」的引用，重新標記階段再掃一次。
- **G1：SATB（Snapshot-At-The-Beginning）**——記錄「被刪除的舊引用」，以標記開始的快照為準。
兩者都靠**寫屏障（write barrier）**攔截引用變更。**面試切入**：能講「為什麼併發 GC 需要寫屏障」就贏一半。

### 7.2 Minor / Major / Full GC 觸發時機
- **Minor GC**：Eden 區滿時觸發，回收新生代，用複製演算法、快。
- **Major GC**：老年代空間不足時觸發（較慢）。
- **Full GC**：老年代滿、Metaspace 滿、`System.gc()`、晉升失敗（promotion failure）、或擔保失敗時觸發，**STW 最久，線上要極力避免**。
**接專案**：wallet 帳務 API 要低延遲，我會盯 GC log，若每次回收後老年代降不下來，多半是洩漏或堆太小。

### 7.3 G1 vs ZGC 怎麼選
- **G1**（Java 9+ 預設）：把堆切成等大 **Region**，按「回收價值」排序優先清垃圾最多的，可設目標停頓 `-XX:MaxGCPauseMillis`。適合**大堆 + 可控停頓**的一般服務。
- **ZGC**：**著色指標 + 讀屏障**，標記與搬遷幾乎全併發，停頓**亞毫秒、與堆大小無關**。適合**超大堆 + 極低延遲**。
**一句話取捨**：一般線上服務 G1 夠用；對延遲尖刺極度敏感（高頻交易、即時下注）才上 ZGC。

---

## 8. 並發深入補充（搭配 `07` 脈絡 J）

### 8.1 JMM 與 happens-before
JMM 規範多執行緒下共享變數的**可見性與有序性**。核心工具是 **happens-before**：若「A happens-before B」，則 A 的結果對 B 一定可見。常用規則：
1. **程式順序**：同執行緒內前面操作對後面可見。
2. **鎖規則**：解鎖 happens-before 後續對同一鎖的加鎖。
3. **volatile 規則**：對 volatile 變數的寫 happens-before 後續的讀。
4. **傳遞性**：A→B、B→C ⇒ A→C。
5. **`Thread.start()`/`join()`**：start 前的操作對新執行緒可見；執行緒結束的操作對 join 後可見。
**面試**：用 happens-before 推導「這段並發程式正不正確」，比死背 volatile 強。

### 8.2 synchronized 鎖升級
JDK 6 後 `synchronized` 按競爭程度逐步升級（**只升不降**），狀態記在物件頭 **Mark Word**：
**無鎖 → 偏向鎖（無競爭，記住上次執行緒）→ 輕量級鎖（CAS 自旋）→ 重量級鎖（OS 互斥量，阻塞）**。
目的是避免一開始就用昂貴的 OS 互斥量。（註：偏向鎖在新版 JDK 已逐步廢棄，但面試仍常考這條升級鏈。）

### 8.3 AQS（AbstractQueuedSynchronizer）
JUC 同步器的**共用底盤**：用一個 `volatile int state` 表示同步狀態（鎖重入次數 / 可用許可數），用一個 **CLH 變體的雙向佇列**管理等待執行緒。子類只需定義「怎麼改 state」（`tryAcquire`/`tryRelease`），排隊與喚醒交給 AQS。`ReentrantLock`、`CountDownLatch`、`Semaphore`、`ReentrantReadWriteLock` 全建在它上面。**理解 AQS = 理解半個 JUC**。

---

## 9. Spring 深入補充（搭配 `07` 脈絡 M）

### 9.1 @Transactional 七種傳播行為
傳播行為決定「有交易的方法呼叫另一個有交易的方法時，怎麼共用/隔離交易」：

| 傳播行為 | 行為 | 典型場景 |
|---|---|---|
| `REQUIRED`（預設） | 有就加入、沒有就新建 | 絕大多數業務方法 |
| `REQUIRES_NEW` | 總是新建，掛起外層 | 記操作日誌（外層回滾也要留） |
| `NESTED` | 巢狀交易（savepoint），可部分回滾 | 子操作失敗只回退子部分 |
| `SUPPORTS` | 有就用、沒有就非交易執行 | 查詢類 |
| `NOT_SUPPORTED` | 掛起交易、非交易執行 | 不需交易的耗時操作 |
| `MANDATORY` | 必須有外層交易，否則拋例外 | 強制被包在交易中 |
| `NEVER` | 必須沒有交易，否則拋例外 | 確保不在交易中 |

**最常考**：`REQUIRED` vs `REQUIRES_NEW`——前者共用同一交易（一起回滾），後者獨立（內層提交不受外層回滾影響）。選錯會出現「以為回滾了其實沒回滾」的隱性 bug。

### 9.2 AOP：JDK 動態代理 vs CGLIB
Spring AOP 要做「方法前後插程式碼」必須先生成**代理物件**：
- **JDK 動態代理**：基於**介面**（`Proxy` + `InvocationHandler`），目標類必須實作介面。
- **CGLIB**：**生成目標類的子類**覆寫方法，無介面也可用，但 `final` 類/方法無法代理。
- **Spring Boot 預設一律用 CGLIB**（`proxyTargetClass=true`）統一行為。
**這解釋了**：為什麼 `@Transactional` 方法要 `public`、類不能 `final`、self-invocation（`this.b()`）會失效——因為都繞過了代理。

---

## 10. JPA 深入補充（搭配 `07` 脈絡 M/N）

### 10.1 實體的四種狀態
- **transient（瞬時）**：`new` 出來、還沒被持久化上下文管理，DB 無對應列。
- **managed（受管）**：被 `persist`/查詢納入持久化上下文，**對它的修改會在 flush 時自動同步到 DB**（髒檢查）。
- **detached（游離）**：交易結束/`clear` 後脫離管理，改它不會自動入庫（存取 LAZY 關聯會 `LazyInitializationException`）。
- **removed（刪除）**：`remove` 標記待刪、flush 時真正 DELETE。

### 10.2 flush 時機與 save vs saveAndFlush
- **flush** 是「把持久化上下文的變更同步到 DB（發 SQL）」，但**不等於 commit**。
- 預設 flush 時機：交易提交前、執行查詢前（保證查到最新）、手動 `flush()`。
- `save` 可能延到 flush/commit 才真正寫；`saveAndFlush` **立刻 flush**、立刻觸發 DB 約束——本專案測「並發建錢包撞 UNIQUE」就要用 `saveAndFlush` 才能在當下捕捉到約束衝突。
**接決策 1**：樂觀鎖的 `version` 不符，正是在 **flush 發出 `UPDATE ... WHERE version=?` 影響 0 列**時，Hibernate 丟 `ObjectOptimisticLockingFailureException`。
