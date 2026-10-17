-- ============================================================
-- 022_confirm_order_payment_rpc.sql
-- Atomic RPC that claims a Razorpay payment, updates the order,
-- inserts confirmed bookings, decrements coupon usage, and
-- upserts the customer loyalty profile — all in one transaction.
--
-- Safety design:
--   • Claims only status = 'pending' rows → never corrupts refund rows
--   • ON CONFLICT (order_item_id) DO NOTHING → idempotent booking insert
--   • Uses COALESCE(advance_paid, 0) + p_verified_amount for additive accumulation
--   • p_verified_amount is in RUPEES (numeric(10,2)) — callers convert paise ÷ 100
-- ============================================================

CREATE OR REPLACE FUNCTION confirm_order_payment(
  p_order_id          UUID,
  p_razorpay_order_id TEXT,
  p_razorpay_payment_id TEXT,
  p_verified_amount   NUMERIC(10,2),  -- in RUPEES, not paise
  p_method            TEXT DEFAULT 'razorpay'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order        RECORD;
  v_payment      RECORD;
  v_item         RECORD;
  v_app_settings JSONB;
  v_earn_rate    NUMERIC;
  v_points_earn  INTEGER := 0;
BEGIN
  -- ── 1. Lock the order row ──────────────────────────────────────────────
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  -- ── 2. Claim the payment — ONLY status = 'pending' ─────────────────────
  -- Matching only 'pending' ensures we never flip a negative refund row.
  UPDATE payments
  SET
    status               = 'completed',
    razorpay_payment_id  = p_razorpay_payment_id,
    collected_at         = NOW(),
    amount               = p_verified_amount
  WHERE razorpay_order_id = p_razorpay_order_id
    AND status            = 'pending'
  RETURNING * INTO v_payment;

  IF NOT FOUND THEN
    -- Check whether a competing thread already completed this exact payment
    IF EXISTS (
      SELECT 1 FROM payments
      WHERE razorpay_payment_id = p_razorpay_payment_id
        AND status = 'completed'
    ) THEN
      RETURN jsonb_build_object(
        'success',          true,
        'already_processed', true,
        'order_id',         p_order_id,
        'order_status',     v_order.status
      );
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'PAYMENT_CLAIM_FAILED');
  END IF;

  -- ── 3. Update order — additive advance accumulation ────────────────────
  -- COALESCE prevents overwriting a previous advance_paid value.
  UPDATE orders
  SET
    status       = 'open',
    advance_paid = COALESCE(advance_paid, 0) + p_verified_amount
  WHERE id = p_order_id;

  -- ── 4. Restore any cancelled order_items to scheduled ──────────────────
  -- Handles the sweeper-timeout revival case where items were auto-cancelled.
  UPDATE order_items
  SET status = 'scheduled'
  WHERE order_id = p_order_id
    AND status   = 'cancelled';

  -- ── 5. Insert confirmed bookings — idempotent ──────────────────────────
  -- ON CONFLICT DO NOTHING means the webhook and confirm-online can both run
  -- without creating duplicates; whichever lands first wins.
  FOR v_item IN (
    SELECT * FROM order_items
    WHERE order_id   = p_order_id
      AND is_deleted = false
      AND scheduled_start IS NOT NULL
      AND scheduled_end   IS NOT NULL
  ) LOOP
    INSERT INTO bookings (
      order_id,
      order_item_id,
      scheduled_start,
      scheduled_end,
      held_until,
      no_show_deadline,
      status
    ) VALUES (
      p_order_id,
      v_item.id,
      v_item.scheduled_start,
      v_item.scheduled_end,
      v_item.scheduled_start + INTERVAL '15 minutes',
      v_item.scheduled_start + INTERVAL '15 minutes',
      'confirmed'
    )
    ON CONFLICT (order_item_id) DO NOTHING;
  END LOOP;

  -- ── 6. Coupon usage increment ──────────────────────────────────────────
  IF v_order.coupon_id IS NOT NULL THEN
    UPDATE coupons
    SET used_count = used_count + 1
    WHERE id = v_order.coupon_id;
  END IF;

  -- ── 7. Customer loyalty points & profile upsert ────────────────────────
  IF v_order.customer_phone IS NOT NULL THEN
    SELECT data INTO v_app_settings FROM app_settings WHERE id = 1;
    v_earn_rate  := COALESCE((v_app_settings -> 'loyalty' ->> 'earn_rupees_per_point')::numeric, 100);
    IF v_earn_rate > 0 THEN
      v_points_earn := FLOOR(p_verified_amount / v_earn_rate)::integer;
    END IF;

    -- Net points = earned - redeemed (redeemed is non-negative, clamp to 0)
    INSERT INTO customer_profiles (phone, name, points_balance, visit_count, total_spent, last_visit_at)
    VALUES (
      v_order.customer_phone,
      v_order.customer_name,
      GREATEST(0, v_points_earn - COALESCE(v_order.points_redeemed, 0)),
      1,
      p_verified_amount,
      NOW()
    )
    ON CONFLICT (phone) DO UPDATE
      SET
        points_balance = GREATEST(0, customer_profiles.points_balance
                          + v_points_earn
                          - COALESCE(v_order.points_redeemed, 0)),
        last_visit_at  = NOW(),
        total_spent    = customer_profiles.total_spent + p_verified_amount;
  END IF;

  -- ── 8. Return result payload ───────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',           true,
    'already_processed', false,
    'order_id',          p_order_id,
    'advance_paid',      p_verified_amount,
    'customer_phone',    v_order.customer_phone,
    'points_earned',     v_points_earn
  );
END;
$$;

-- Grant execute only to the service-role (used by createAdminClient)
REVOKE ALL ON FUNCTION confirm_order_payment FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_order_payment TO service_role;
