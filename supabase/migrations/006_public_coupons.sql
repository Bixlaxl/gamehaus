-- 006_public_coupons.sql
-- Add is_public boolean to coupons table to support public deals system

ALTER TABLE coupons ADD COLUMN is_public boolean NOT NULL DEFAULT false;
