-- ============================================================
-- 010_membership_plan_bounds.sql
-- Add bound_table_ids to membership_plans to support templates binding to assets.
-- ============================================================

ALTER TABLE membership_plans
  ADD COLUMN IF NOT EXISTS bound_table_ids UUID[] NOT NULL DEFAULT '{}';
