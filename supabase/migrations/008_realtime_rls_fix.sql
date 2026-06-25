-- ============================================================
-- 008_realtime_rls_fix.sql
-- Fix Realtime updates for order_items, order_extras, and bookings.
-- Supabase Realtime does not support EXISTS subqueries in SELECT policies.
-- We split RLS policies into subquery-free SELECT commands and secure WRITE commands.
-- ============================================================

-- ─── 1. ORDER_ITEMS ─────────────────────────────────────────
drop policy if exists "Staff can read/write order_items via orders" on order_items;
drop policy if exists "Staff can view order_items" on order_items;
drop policy if exists "Staff can insert order_items" on order_items;
drop policy if exists "Staff can update order_items" on order_items;
drop policy if exists "Staff can delete order_items" on order_items;

create policy "Staff can view order_items"
  on order_items for select to authenticated
  using (true);

create policy "Staff can insert order_items"
  on order_items for insert to authenticated
  with check (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  );

create policy "Staff can update order_items"
  on order_items for update to authenticated
  using (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  )
  with check (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  );

create policy "Staff can delete order_items"
  on order_items for delete to authenticated
  using (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  );


-- ─── 2. ORDER_EXTRAS ────────────────────────────────────────
drop policy if exists "Staff can read/write order_extras via orders" on order_extras;
drop policy if exists "Staff can view order_extras" on order_extras;
drop policy if exists "Staff can insert order_extras" on order_extras;
drop policy if exists "Staff can update order_extras" on order_extras;
drop policy if exists "Staff can delete order_extras" on order_extras;

create policy "Staff can view order_extras"
  on order_extras for select to authenticated
  using (true);

create policy "Staff can insert order_extras"
  on order_extras for insert to authenticated
  with check (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  );

create policy "Staff can update order_extras"
  on order_extras for update to authenticated
  using (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = order_extras.order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  )
  with check (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = order_extras.order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  );

create policy "Staff can delete order_extras"
  on order_extras for delete to authenticated
  using (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = order_extras.order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  );


-- ─── 3. BOOKINGS ────────────────────────────────────────────
drop policy if exists "Staff can read/write bookings at their location" on bookings;
drop policy if exists "Staff can view bookings" on bookings;
drop policy if exists "Staff can insert bookings" on bookings;
drop policy if exists "Staff can update bookings" on bookings;
drop policy if exists "Staff can delete bookings" on bookings;

create policy "Staff can view bookings"
  on bookings for select to authenticated
  using (true);

create policy "Staff can insert bookings"
  on bookings for insert to authenticated
  with check (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  );

create policy "Staff can update bookings"
  on bookings for update to authenticated
  using (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = bookings.order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  )
  with check (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = bookings.order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  );

create policy "Staff can delete bookings"
  on bookings for delete to authenticated
  using (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = bookings.order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  );

-- ─── 4. REPLICATION PUBLICATION ─────────────────────────────
-- Enable Realtime replication for POS tables if not already present.
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
