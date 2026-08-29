-- 019_revenue_summary_rpc.sql
-- Create a server-side aggregation function so the Overview dashboard can get
-- revenue + order_count in a single row instead of fetching every order row
-- (which hits the Supabase PostgREST default 1000-row cap on busy months).

CREATE OR REPLACE FUNCTION get_revenue_summary(
  from_ts TIMESTAMPTZ,
  to_ts   TIMESTAMPTZ DEFAULT NULL,
  loc_id  UUID        DEFAULT NULL
)
RETURNS TABLE(revenue NUMERIC, order_count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(SUM(COALESCE(amount_due, 0) + COALESCE(advance_paid, 0)), 0) AS revenue,
    COUNT(*)::BIGINT AS order_count
  FROM orders
  WHERE status = 'finalized'
    AND finalized_at >= from_ts
    AND (to_ts IS NULL OR finalized_at <= to_ts)
    AND (loc_id IS NULL OR location_id = loc_id);
$$;
