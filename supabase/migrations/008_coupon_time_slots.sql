-- 008_coupon_time_slots.sql
-- Add valid_from_time and valid_until_time columns to coupons table to support Happy Hours / Time Slot availability

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS valid_from_time text DEFAULT NULL;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS valid_until_time text DEFAULT NULL;
