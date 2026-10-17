-- ============================================================
-- 021_booking_integrity_constraints.sql
-- Integrity constraints for booking/payment correctness.
-- All operations are additive — no existing columns altered.
-- ============================================================

-- 1. Add no_show_deadline to bookings
--    Stores the hard cutoff after which staff can mark a prepaid customer as no-show.
--    Defaults to scheduled_start + 15 minutes (computed at booking-confirmation time).
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS no_show_deadline timestamptz;

-- 2. Unique constraint on bookings(order_item_id)
--    Prevents the payment webhook and confirm-online from racing and
--    inserting duplicate booking rows for the same order_item.
--    Uses IF NOT EXISTS guard via DO block for idempotency.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_order_item_id_key'
      AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_order_item_id_key UNIQUE (order_item_id);
  END IF;
END $$;

-- 3. Unique partial index on payments(razorpay_order_id) for pending rows
--    Prevents two concurrent Razorpay orders from being created for the same slot
--    and later double-claiming. Applies only where razorpay_order_id is not null.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_razorpay_order_id_pending
  ON payments (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL
    AND status = 'pending';

-- 4. Unique partial index on payments(razorpay_payment_id)
--    Prevents the same Razorpay payment being linked to two payment rows,
--    which would happen if the webhook fires multiple times before idempotency lock.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_razorpay_payment_id
  ON payments (razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;
