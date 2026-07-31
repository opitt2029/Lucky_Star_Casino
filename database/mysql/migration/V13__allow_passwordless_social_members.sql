ALTER TABLE members
    MODIFY COLUMN password_hash VARCHAR(255) NULL
    COMMENT 'BCrypt 雜湊密碼；純第三方會員可為 NULL';
