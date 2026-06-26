-- ============================================================
-- 011_membership_short_id.sql
-- Add short_id to customer_memberships and free_hours_to_redeem to order_items.
-- ============================================================

ALTER TABLE customer_memberships
  ADD COLUMN IF NOT EXISTS short_id TEXT UNIQUE;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS free_hours_to_redeem NUMERIC;
