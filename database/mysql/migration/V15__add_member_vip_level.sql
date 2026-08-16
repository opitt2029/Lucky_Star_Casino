-- 會員分級：gateway 每玩家令牌桶依此欄位選擇限流參數（NORMAL / VIP）。
-- 值域刻意用字串而非 ENUM，比照既有的 members.role / members.status。
-- 新增欄位帶 DEFAULT，既有列自動補 'NORMAL'（＝維持現行限流），無需資料回填。
ALTER TABLE members
    ADD COLUMN vip_level VARCHAR(20) NOT NULL DEFAULT 'NORMAL' AFTER status;
