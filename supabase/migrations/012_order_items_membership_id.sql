-- ============================================================
-- 012_order_items_membership_id.sql
-- Add membership_id column to order_items referencing customer_memberships.
-- ============================================================

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS membership_id UUID REFERENCES customer_memberships(id) ON DELETE SET NULL;
