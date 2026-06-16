# Phase 2 — Admin 地基（P1）

> 含任務：T-050（Admin JWT 角色區分 + Spring Security）
> 目標：建立 admin-service 的認證/授權地基。**這是所有 Admin API（T-051~T-055, T-105, T-106）的前置**，務必先做。
> 現況：admin-service 仍空殼（只有 DataSourceConfig / PostgresJpaConfig），無 controller/security。

---

## T-050　Admin 後台 JWT 認證（角色區分）

**前置依賴**：admin-service 骨架（T-003✅）。
**涉及檔**（新增）：
- `config/SecurityConfig.java`
- `security/AdminJwtAuthFilter.java`、`security/AdminJwtUtil.java`
- `entity/AdminUser.java`、`repository/AdminUserRepository.java`
- `controller/AdminAuthController.java`（登入）
- `application.yml`（`admin.jwt.secret`）

### Step
1. **獨立 JWT Secret**：用 `ADMIN_JWT_SECRET`（與玩家 `JWT_SECRET` 分開；AGENTS.md §地雷），JJWT 0.12.6 簽發/驗證。
2. **角色設計**：`SUPER_ADMIN` / `OPERATOR` 兩種 role，存 `admin_users` 表（PostgreSQL）。
3. **Spring Security 設定**：`/admin/**` 需 `ROLE_ADMIN`（含上述兩 role）；普通玩家 token 因 secret 不同 → 驗章失敗 → 401。
4. **登入端點**：`POST /admin/auth/login`（帳密 → 回 admin JWT）。密碼用 BCrypt。
5. **JWT Filter**：解析 admin token、塞 `SecurityContext`、放行/拒絕。
6. **方法級授權**：敏感操作（如 GM 發幣 T-055）加 `@PreAuthorize("hasRole('SUPER_ADMIN')")`。
7. **測試**：
   - context loads（H2 test scope，比照 member/wallet）。
   - 無 token → 401；玩家 token → 401；admin token → 200。
   - role 不足 → 403。

### 交付物
Admin JWT + Security Config + 登入 API + 測試。

### 驗收標準
- `/admin/**` 未帶 admin token 一律 401。
- 玩家 token 無法存取 admin（secret 隔離）。
- role 區分生效（OPERATOR 不能做 SUPER_ADMIN 限定操作）。

### 驗證
```bash
mvn -pl backend/admin-service test
```

### 地雷
- admin-service 連 PostgreSQL（帳務庫同庫不同表）→ 沿用既有 `DataSourceConfig`，別亂加第二資料源觸發雙源假設。
- 測試要加 H2 + test `application.yml`，否則 CI 起不來。
- `@Bean` 不可同名（Spring Boot 3.2+）。

**工時**：3h
