-- ============================================================
-- 009_membership_multi_asset.sql
-- Add multi-asset binding and ledger columns to customer_memberships,
-- and link orders directly to their corresponding customer_memberships.
-- ============================================================

-- 1. Modify customer_memberships
ALTER TABLE customer_memberships
  ADD COLUMN IF NOT EXISTS bound_table_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS free_hours_ledger JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Modify orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS membership_id UUID REFERENCES customer_memberships(id) ON DELETE SET NULL;
