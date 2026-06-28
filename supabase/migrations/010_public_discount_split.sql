-- ============================================================
-- 010_public_discount_split.sql
-- Split discount_amount into public (coupon-only) and member portions.
--
-- Business rule:
--   • Public/coupon discount → original scheduled session only, fixed at booking time
--   • Member discount        → session + extensions + extras, always computed live at finalize
--
-- public_discount_amount stores only the coupon portion.
-- discount_amount keeps its current meaning (public + member combined) for display/reporting.
-- At finalize, the billing engine receives public_discount_amount as fixedDiscountAmount
-- so the member % is never double-applied.
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS public_discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Back-fill existing rows:
--   If the order has a coupon, we can't perfectly split the baked-in discount,
--   so we assume discount_amount = public+member and set public portion to discount_amount
--   for legacy rows (safe conservative default — no double-counting for old orders).
--   New orders will write the exact public portion going forward.
UPDATE orders SET public_discount_amount = discount_amount WHERE public_discount_amount = 0;
