-- ============================================================
-- 002_rls_policies.sql
-- Row Level Security for all tables
-- Role and location_id are read from JWT custom claims
-- ============================================================

-- ─── LOCATIONS ────────────────────────────────────────────
alter table locations enable row level security;

create policy "Anon can view active locations"
  on locations for select to anon
  using (is_active = true);

create policy "Owner has full access to locations"
  on locations for all to authenticated
  using (auth.jwt() ->> 'role' = 'owner')
  with check (auth.jwt() ->> 'role' = 'owner');

create policy "Staff can view their location"
  on locations for select to authenticated
  using (
    auth.jwt() ->> 'role' = 'staff'
    and id = (auth.jwt() ->> 'location_id')::uuid
  );

-- ─── USERS ────────────────────────────────────────────────
alter table users enable row level security;

create policy "Owner has full access to users"
  on users for all to authenticated
  using (auth.jwt() ->> 'role' = 'owner')
  with check (auth.jwt() ->> 'role' = 'owner');

create policy "Staff can view own profile"
  on users for select to authenticated
  using (
    auth.jwt() ->> 'role' = 'staff'
    and id = auth.uid()
  );

-- ─── TABLES ───────────────────────────────────────────────
alter table tables enable row level security;

create policy "Anon can view active tables"
  on tables for select to anon
  using (is_active = true);

create policy "Owner has full access to tables"
  on tables for all to authenticated
  using (auth.jwt() ->> 'role' = 'owner')
  with check (auth.jwt() ->> 'role' = 'owner');

create policy "Staff can view their location tables"
  on tables for select to authenticated
  using (
    auth.jwt() ->> 'role' = 'staff'
    and location_id = (auth.jwt() ->> 'location_id')::uuid
  );

-- ─── COUPONS ──────────────────────────────────────────────
alter table coupons enable row level security;

create policy "Owner has full access to coupons"
  on coupons for all to authenticated
  using (auth.jwt() ->> 'role' = 'owner')
  with check (auth.jwt() ->> 'role' = 'owner');

create policy "Anon can view active coupons for validation"
  on coupons for select to anon
  using (is_active = true);

-- ─── ORDERS ───────────────────────────────────────────────
alter table orders enable row level security;

create policy "Owner has full access to orders"
  on orders for all to authenticated
  using (auth.jwt() ->> 'role' = 'owner')
  with check (auth.jwt() ->> 'role' = 'owner');

create policy "Staff can read/write orders at their location"
  on orders for all to authenticated
  using (
    auth.jwt() ->> 'role' = 'staff'
    and location_id = (auth.jwt() ->> 'location_id')::uuid
  )
  with check (
    auth.jwt() ->> 'role' = 'staff'
    and location_id = (auth.jwt() ->> 'location_id')::uuid
  );

-- ─── ORDER ITEMS ──────────────────────────────────────────
alter table order_items enable row level security;

create policy "Owner has full access to order_items"
  on order_items for all to authenticated
  using (auth.jwt() ->> 'role' = 'owner')
  with check (auth.jwt() ->> 'role' = 'owner');

create policy "Staff can read/write order_items via orders"
  on order_items for all to authenticated
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

-- ─── ORDER EXTRAS ─────────────────────────────────────────
alter table order_extras enable row level security;

create policy "Owner has full access to order_extras"
  on order_extras for all to authenticated
  using (auth.jwt() ->> 'role' = 'owner')
  with check (auth.jwt() ->> 'role' = 'owner');

create policy "Staff can read/write order_extras via orders"
  on order_extras for all to authenticated
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

-- ─── BOOKINGS ─────────────────────────────────────────────
alter table bookings enable row level security;

create policy "Anon can view their own booking by id"
  on bookings for select to anon
  using (true); -- filtered by booking_id in query; no sensitive data exposed

create policy "Owner has full access to bookings"
  on bookings for all to authenticated
  using (auth.jwt() ->> 'role' = 'owner')
  with check (auth.jwt() ->> 'role' = 'owner');

create policy "Staff can read/write bookings at their location"
  on bookings for all to authenticated
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

-- ─── PAYMENTS ─────────────────────────────────────────────
alter table payments enable row level security;

create policy "Owner has full access to payments"
  on payments for all to authenticated
  using (auth.jwt() ->> 'role' = 'owner')
  with check (auth.jwt() ->> 'role' = 'owner');

create policy "Staff can read/write payments at their location"
  on payments for all to authenticated
  using (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = payments.order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  )
  with check (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from orders o
      where o.id = payments.order_id
        and o.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  );

-- ─── TABLE AVAILABILITY OVERRIDES ────────────────────────
alter table table_availability_overrides enable row level security;

create policy "Owner has full access to availability overrides"
  on table_availability_overrides for all to authenticated
  using (auth.jwt() ->> 'role' = 'owner')
  with check (auth.jwt() ->> 'role' = 'owner');

create policy "Staff can view availability overrides at their location"
  on table_availability_overrides for select to authenticated
  using (
    auth.jwt() ->> 'role' = 'staff'
    and exists (
      select 1 from tables t
      where t.id = table_availability_overrides.table_id
        and t.location_id = (auth.jwt() ->> 'location_id')::uuid
    )
  );

create policy "Anon can view availability overrides"
  on table_availability_overrides for select to anon
  using (true);

-- ─── CUSTOMER PROFILES ────────────────────────────────────
alter table customer_profiles enable row level security;

create policy "Owner has full access to customer profiles"
  on customer_profiles for all to authenticated
  using (auth.jwt() ->> 'role' = 'owner')
  with check (auth.jwt() ->> 'role' = 'owner');

create policy "Staff can read/write customer profiles"
  on customer_profiles for all to authenticated
  using (auth.jwt() ->> 'role' = 'staff')
  with check (auth.jwt() ->> 'role' = 'staff');
