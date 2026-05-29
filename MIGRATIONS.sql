-- ============================================================
-- Gamehaus — DB Migrations (run in Supabase SQL Editor)
-- ============================================================

-- Phase 2: Inventory catalogue (per location)
CREATE TABLE IF NOT EXISTS inventory_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'Other',
  selling_price   NUMERIC NOT NULL,
  cost_price      NUMERIC NOT NULL DEFAULT 0,
  image_url       TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Snapshot cost_price + link back to catalogue on each extra sold
ALTER TABLE order_extras ADD COLUMN IF NOT EXISTS inventory_item_id UUID REFERENCES inventory_items(id);
ALTER TABLE order_extras ADD COLUMN IF NOT EXISTS cost_price NUMERIC NOT NULL DEFAULT 0;

-- Phase 4: Per-person / per-controller pricing stored as JSONB
-- snooker/pool: {"4": 800, "5": 1000, "6": 1200}
-- ps5:          {"1": 400, "2": 600}
-- foosball:     null (flat hourly_rate only)
ALTER TABLE tables ADD COLUMN IF NOT EXISTS people_pricing JSONB;

-- Phase 5: Membership plans
CREATE TABLE IF NOT EXISTS membership_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  price           NUMERIC NOT NULL,
  duration_days   INTEGER NOT NULL,
  discount_pct    NUMERIC NOT NULL DEFAULT 0,
  free_hrs        NUMERIC NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Assigned memberships (one active per customer)
CREATE TABLE IF NOT EXISTS customer_memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone  TEXT NOT NULL,
  plan_id         UUID NOT NULL REFERENCES membership_plans(id),
  starts_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  free_hrs_used   NUMERIC NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_memberships_phone ON customer_memberships(customer_phone);
CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON inventory_items(location_id);

-- Composite index for finalize-route lookup: phone + is_active + expires_at
-- (hot path on every walk-in finalization)
CREATE INDEX IF NOT EXISTS idx_customer_memberships_active_lookup
  ON customer_memberships(customer_phone, is_active, expires_at);

-- Reports page joins order_extras to orders; the FK already auto-indexes order_id in most setups,
-- but we add it explicitly to be safe (Supabase doesn't always auto-index FKs)
CREATE INDEX IF NOT EXISTS idx_order_extras_order_id ON order_extras(order_id);

-- Inventory picker in POS sorts active items by category — index speeds the active-only filter
CREATE INDEX IF NOT EXISTS idx_inventory_items_location_active
  ON inventory_items(location_id, is_active) WHERE is_active = TRUE;

-- Customer name autocomplete on the POS walk-in panel.
-- Without this index, every keystroke triggers a full table scan over
-- customer_profiles. text_pattern_ops makes LIKE 'prefix%' a fast B-tree seek.
CREATE INDEX IF NOT EXISTS idx_customer_profiles_lower_name
  ON customer_profiles (lower(name) text_pattern_ops)
  WHERE name IS NOT NULL;

-- ============================================================
-- REALTIME PUBLICATION (run once per environment)
-- ============================================================
--
-- The POS staff side subscribes to Supabase Realtime so that bookings,
-- walk-ins, session changes, and extras propagate without polling.
-- This block adds the required tables to the supabase_realtime publication
-- only if they're not already members — safe to re-run.
--
-- After running, verify in the Supabase dashboard:
--   Database → Replication → supabase_realtime publication
-- Should list: orders, order_items, order_extras, bookings, tables
--
-- Symptom of missing realtime: upcoming bookings or session changes only
-- appear after a manual page reload (or after the 5-min safety-net poll).

DO $$
DECLARE
  t TEXT;
  tables_to_publish TEXT[] := ARRAY['orders', 'order_items', 'order_extras', 'bookings', 'tables'];
BEGIN
  FOREACH t IN ARRAY tables_to_publish LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
      RAISE NOTICE 'Added % to supabase_realtime publication', t;
    ELSE
      RAISE NOTICE 'Skipped % (already in publication)', t;
    END IF;
  END LOOP;
END $$;
