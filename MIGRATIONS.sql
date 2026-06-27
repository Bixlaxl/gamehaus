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

-- Phase 4b: Per-session player / controller count.
-- Snapshot of how many people the rate_per_hour was set for, so staff can
-- adjust mid-session ("customer brought an extra friend") and the bill
-- recomputes by looking up the new rate from tables.people_pricing.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS num_people INTEGER;

-- Phase 6: Inventory stock tracking + restock log
-- stock_count is the source of truth ("how many units on hand right now").
-- low_stock_threshold optionally triggers a warning badge in the UI.
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS stock_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 5;

-- Every change to stock_count is logged here so owner can audit movement.
-- change = positive for restock / adjustment-up, negative for sale / adjustment-down.
CREATE TABLE IF NOT EXISTS inventory_stock_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  location_id       UUID NOT NULL REFERENCES locations(id),
  change            INTEGER NOT NULL,
  reason            TEXT NOT NULL,                 -- 'restock' | 'sale' | 'adjustment' | 'reverse'
  order_extra_id    UUID REFERENCES order_extras(id) ON DELETE SET NULL,
  note              TEXT,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_stock_logs_item    ON inventory_stock_logs(inventory_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_stock_logs_loc     ON inventory_stock_logs(location_id, created_at DESC);

-- Phase 7: Single-row app-wide settings (loyalty, stock, booking policy)
-- Stored as one JSONB blob so we don't migrate the schema every time we add
-- a new knob. id is CHECK-constrained to 1 so the table can only ever have
-- one row.
CREATE TABLE IF NOT EXISTS app_settings (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data        JSONB   NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES users(id)
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

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

-- Customer phone autocomplete on the POS walk-in panel (same pattern as name).
-- The unique constraint on phone gives us a B-tree index already, but with the
-- default operator class — which Postgres won't use for LIKE 'prefix%'. The
-- text_pattern_ops variant is what makes prefix search a fast seek.
CREATE INDEX IF NOT EXISTS idx_customer_profiles_phone_prefix
  ON customer_profiles (phone text_pattern_ops);

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


-- ============================================================
-- SUPPORT CUSTOM / DYNAMIC TABLE TYPES
-- ============================================================
-- Drop the check constraint on table type to allow custom table types (e.g. simulator).
-- Run this in your Supabase SQL editor:
ALTER TABLE tables DROP CONSTRAINT IF EXISTS tables_type_check;


-- ============================================================
-- PERFORMANCE OPTIMIZATION INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orders_location_status ON orders(location_id, status);
CREATE INDEX IF NOT EXISTS idx_tables_location ON tables(location_id, is_active);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_table_id ON order_items(table_id);
CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items(status);
CREATE INDEX IF NOT EXISTS idx_bookings_order_id ON bookings(order_id);
CREATE INDEX IF NOT EXISTS idx_bookings_order_item_id ON bookings(order_item_id);
CREATE INDEX IF NOT EXISTS idx_bookings_scheduled_start ON bookings(scheduled_start, status);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);


-- ============================================================
-- PUBLIC DEALS SYSTEM
-- ============================================================
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;


-- ============================================================
-- LOCATION IMAGES
-- ============================================================
ALTER TABLE locations DROP COLUMN IF EXISTS image_url;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}';


-- ============================================================
-- REALTIME RLS FIX (008_realtime_rls_fix.sql)
-- ============================================================
-- Split RLS policies for order_items, order_extras, and bookings.
-- Uses subquery-free SELECT filters for staff to enable Supabase Realtime broadcast.
-- WRITE operations (INSERT, UPDATE, DELETE) remain securely location-validated.


-- ============================================================
-- MULTI-ASSET FREE HOURS MEMBERSHIP (009_membership_multi_asset.sql)
-- ============================================================
ALTER TABLE customer_memberships
  ADD COLUMN IF NOT EXISTS bound_table_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS free_hours_ledger JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS membership_id UUID REFERENCES customer_memberships(id) ON DELETE SET NULL;


-- ============================================================
-- TEMPLATE MEMBERSHIP PLAN BOUNDS (010_membership_plan_bounds.sql)
-- ============================================================
ALTER TABLE membership_plans
  ADD COLUMN IF NOT EXISTS bound_table_ids UUID[] NOT NULL DEFAULT '{}';


-- ============================================================
-- SHORT MEMBERSHIP ID COLUMN (011_membership_short_id.sql)
-- ============================================================
ALTER TABLE customer_memberships
  ADD COLUMN IF NOT EXISTS short_id TEXT UNIQUE;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS free_hours_to_redeem NUMERIC;


-- ============================================================
-- ORDER ITEMS MEMBERSHIP ID (012_order_items_membership_id.sql)
-- ============================================================
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS membership_id UUID REFERENCES customer_memberships(id) ON DELETE SET NULL;

