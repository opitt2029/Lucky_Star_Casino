-- Add player inventory usage/equipment state for shop redemptions.
ALTER TABLE shop_redemptions
    ADD COLUMN IF NOT EXISTS used_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS equipped_at TIMESTAMP;

ALTER TABLE shop_redemptions
    DROP CONSTRAINT IF EXISTS chk_shop_status;

ALTER TABLE shop_redemptions
    ADD CONSTRAINT chk_shop_status
        CHECK (status IN ('COMPLETED', 'PENDING', 'FAILED', 'USED', 'EQUIPPED'));