ALTER TABLE members
    ADD COLUMN real_name VARCHAR(80) NULL AFTER nickname,
    ADD COLUMN birth_date DATE NULL AFTER real_name,
    ADD COLUMN gender VARCHAR(20) NULL AFTER birth_date,
    ADD COLUMN address VARCHAR(255) NULL AFTER gender,
    ADD COLUMN wallet_payment_method VARCHAR(30) NOT NULL DEFAULT 'STAR_COIN' AFTER address,
    ADD COLUMN payment_confirmation_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER wallet_payment_method;
