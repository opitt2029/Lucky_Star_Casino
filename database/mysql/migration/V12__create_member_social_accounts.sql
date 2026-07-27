CREATE TABLE IF NOT EXISTS member_social_accounts (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    member_id        BIGINT       NOT NULL,
    provider         VARCHAR(20)  NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    email            VARCHAR(255) NULL,
    display_name     VARCHAR(100) NULL,
    avatar_url       TEXT         NULL,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                         ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT pk_member_social_accounts PRIMARY KEY (id),
    CONSTRAINT uq_social_provider_subject UNIQUE (provider, provider_subject),
    CONSTRAINT uq_social_member_provider UNIQUE (member_id, provider),
    CONSTRAINT fk_social_member FOREIGN KEY (member_id)
        REFERENCES members (id) ON DELETE CASCADE,
    CONSTRAINT chk_social_provider CHECK (provider IN ('line', 'google', 'apple'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
