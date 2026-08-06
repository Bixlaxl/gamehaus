-- 016_coupon_days.sql
-- Add valid_days column to coupons table to support day-of-week constraints (0=Sunday, 1=Monday, etc.)
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS valid_days integer[] DEFAULT NULL;
