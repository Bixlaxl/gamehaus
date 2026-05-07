-- ============================================================
-- 001_initial_schema.sql
-- Full schema for Gamehaus Snooker & Gaming Café
-- ============================================================

-- ─── LOCATIONS ────────────────────────────────────────────
create table locations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  address       text not null,
  phone         text,
  timezone      text not null default 'Asia/Kolkata',
  opening_time  time not null default '10:00',
  closing_time  time not null default '23:00',
  slug          text unique not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ─── USERS ────────────────────────────────────────────────
create table users (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  email       text not null,
  role        text not null check (role in ('owner', 'staff')),
  location_id uuid references locations(id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint staff_must_have_location check (
    role = 'owner' or location_id is not null
  )
);

-- ─── TABLES ───────────────────────────────────────────────
create table tables (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references locations(id),
  name         text not null,
  type         text not null check (type in ('snooker', 'pool', 'ps5')),
  size         text,
  description  text,
  image_url    text,
  hourly_rate  numeric(10,2) not null,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ─── COUPONS (referenced by orders) ──────────────────────
create table coupons (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid references locations(id), -- null = all locations
  code            text unique not null,
  discount_type   text not null check (discount_type in ('percent', 'flat')),
  discount_value  numeric(10,2) not null,
  valid_from      timestamptz not null,
  valid_until     timestamptz not null,
  max_uses        integer,
  used_count      integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ─── ORDERS ───────────────────────────────────────────────
create table orders (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references locations(id),
  type            text not null check (type in ('online', 'walk_in')),
  customer_name   text not null,
  customer_phone  text,
  status          text not null default 'open'
                  check (status in ('open', 'finalized', 'cancelled')),
  coupon_id       uuid references coupons(id),
  subtotal        numeric(10,2),
  discount_amount numeric(10,2) default 0,
  total_amount    numeric(10,2),
  advance_paid    numeric(10,2) default 0,
  amount_due      numeric(10,2),
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  finalized_at    timestamptz
);

-- ─── ORDER ITEMS ──────────────────────────────────────────
create table order_items (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null references orders(id),
  table_id                uuid not null references tables(id),
  status                  text not null default 'scheduled'
                          check (status in ('scheduled','running','finished','cancelled')),
  scheduled_start         timestamptz,
  scheduled_end           timestamptz,
  scheduled_duration_mins integer,
  actual_start            timestamptz,
  actual_end              timestamptz,
  expected_end            timestamptz,
  extended_mins           integer not null default 0,
  rate_per_hour           numeric(10,2) not null,
  final_amount            numeric(10,2),
  is_deleted              boolean not null default false,
  deleted_at              timestamptz,
  created_at              timestamptz not null default now()
);

-- ─── ORDER EXTRAS ─────────────────────────────────────────
create table order_extras (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id),
  name       text not null,
  price      numeric(10,2) not null,
  quantity   integer not null default 1,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  added_by   uuid references users(id),
  created_at timestamptz not null default now()
);

-- ─── BOOKINGS (online only) ───────────────────────────────
create table bookings (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id),
  order_item_id     uuid not null references order_items(id),
  scheduled_start   timestamptz not null,
  scheduled_end     timestamptz not null,
  held_until        timestamptz not null, -- scheduled_start + 15 mins
  status            text not null default 'confirmed'
                    check (status in ('confirmed','checked_in','no_show','cancelled')),
  no_show_marked_by uuid references users(id),
  no_show_marked_at timestamptz,
  created_at        timestamptz not null default now()
);

-- ─── PAYMENTS ─────────────────────────────────────────────
create table payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id),
  amount              numeric(10,2) not null,
  method              text not null check (method in ('cash','upi','card','razorpay')),
  razorpay_order_id   text,
  razorpay_payment_id text,
  status              text not null default 'pending'
                      check (status in ('pending','completed','failed','refunded')),
  collected_by        uuid references users(id),
  collected_at        timestamptz,
  created_at          timestamptz not null default now()
);

-- ─── TABLE AVAILABILITY OVERRIDES ────────────────────────
create table table_availability_overrides (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references tables(id),
  date       date not null,
  start_time time,
  end_time   time,
  is_blocked boolean not null default true,
  reason     text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ─── CUSTOMER PROFILES ────────────────────────────────────
create table customer_profiles (
  id            uuid primary key default gen_random_uuid(),
  phone         text unique not null,
  name          text,
  visit_count   integer not null default 0,
  total_spent   numeric(10,2) not null default 0,
  last_visit_at timestamptz,
  created_at    timestamptz not null default now()
);
