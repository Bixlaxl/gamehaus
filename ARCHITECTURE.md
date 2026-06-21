# Gamehaus — System Architecture

A complete reference for how this codebase is wired together. Use this when you need to understand any single piece in context, or when onboarding someone new.

---

## 1. What this app does

Gamehaus is a booking + POS system for two physical snooker/gaming café locations (Bandra, Andheri). It serves three audiences:

| Audience | What they do |
|---|---|
| **Customer** (public) | Browse tables online, pick time slots, pay an advance or full amount via Razorpay, receive a confirmation, optionally cancel |
| **Staff** (POS) | See live table state for their location, process walk-ins, check in online bookings, start/stop sessions, add inventory items to the bill, collect payment |
| **Owner** (admin) | Manage locations, tables, inventory, staff accounts, coupons, memberships; view bookings, customers, reports |

Production usage target: 2–3 staff continuously active per location, 1 owner, 40–50 concurrent customers, realtime updates on for the staff side at all times.

---

## 2. Tech stack

### Runtime / deployment
- **Next.js 14** (App Router) deployed on **Vercel**
- All routes run on **Edge Runtime** (`export const runtime = 'edge'`) — no cold starts on serverless cold-start scales, fast TTFB

### Data layer
- **Supabase** — Postgres + Auth + Realtime + Storage
  - `@supabase/ssr` for cookie-based session sync between server and browser
  - `@supabase/supabase-js` for the actual client (admin and browser variants)
  - Auth gates POS and Owner via JWT in HTTP-only cookies
  - Realtime subscriptions on `order_items`, `orders`, `bookings`, `order_extras`, `tables`
  - Storage bucket `table-images` holds table and inventory item photos

### Client state
- **Zustand** — two stores:
  - `store/pos.ts` — POS in-memory state (no persistence) — tables, orders, modal/slider open-state, 1-second clock tick
  - `store/cart.ts` — Customer cart, **persisted to localStorage** under `gamehaus-cart`
- **TanStack Query v5** — server-state cache with `staleTime`, `initialData`, optimistic mutations
  - Configured in `components/providers.tsx`: 60s default `staleTime`, no `refetchOnWindowFocus`

### Payments
- **Razorpay** — checkout via injected JS (`<Script strategy="lazyOnload">`), server-side order creation, webhook for capture confirmation

### UI
- **Tailwind CSS** + **shadcn/ui** primitives (Radix wrappers)
- **lucide-react** for icons
- **sonner** for toast notifications
- **next-themes** for light/dark switching
- **next/image** for image optimization (WebP, lazy load, responsive sizes)

### Validation
- **Zod** schemas in [`lib/validators/schemas.ts`](lib/validators/schemas.ts)

### Testing
- **Vitest** — primarily covers `lib/billing/engine.test.ts`

### Env vars required
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
NEXT_PUBLIC_RAZORPAY_KEY_ID
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
```

---

## 3. Roles

| Role | Set in | Access |
|---|---|---|
| `owner` | `public.users.role = 'owner'`, JWT claim `app_role: 'owner'` | `/owner/*` + everything below |
| `staff` | `public.users.role = 'staff'`, JWT claim `app_role: 'staff'` | `/pos` only |
| (none) | Customers are not authenticated | `/`, `/[locationSlug]`, `/[locationSlug]/book`, `/booking/[bookingId]` |

Middleware ([`middleware.ts`](middleware.ts)) enforces role-based redirects.

---

## 4. Directory layout

```
app/
├── (auth)/login/page.tsx             # login form (client)
├── (owner)/
│   ├── layout.tsx                    # owner-only layout (server)
│   └── owner/
│       ├── page.tsx                  # dashboard
│       ├── locations/{page,content,loading}
│       ├── tables/{page,content,loading}
│       ├── inventory/{page,content,loading}
│       ├── staff/{page,content,loading}
│       ├── bookings/{page,content,loading}
│       ├── customers/{page,content,loading}
│       ├── memberships/{page,content,loading}
│       ├── coupons/{page,content,loading}
│       ├── reports/{page,content,loading}
│       └── settings/page.tsx
├── (pos)/pos/page.tsx                # POS shell (server) → POSScreen (client)
├── (public)/
│   ├── page.tsx                      # landing
│   ├── [locationSlug]/page.tsx       # location browse + slot picker
│   ├── [locationSlug]/book/page.tsx  # checkout
│   └── booking/[bookingId]/page.tsx  # post-payment confirmation
└── api/                              # all server routes (Edge)
    ├── orders/                       # create + finalize + extras
    ├── walkin/                       # staff-side walk-in creation
    ├── bookings/[id]/                # checkin, noshow, reschedule
    ├── sessions/                     # start, stop, extend, people (player count)
    ├── payments/                     # create-order, webhook, demo-confirm
    ├── coupons/validate              # live coupon check
    ├── customers/lookup              # phone → loyalty profile
    ├── settings/                     # global settings CRUD
    ├── inventory/ + memberships/     # CRUD + stock/low-stock/applying thresholds
    ├── locations/ + tables/ + staff/ # CRUD
    ├── tables/[id]/slots             # blocked-slot lookup for one table
    └── pos/                          # POS data feeds (tables, orders, bookings)

components/
├── pos/
│   ├── pos-screen.tsx                # shell that mounts grid + panel + overlays
│   ├── table-grid.tsx                # the table cards (idle/running/booked/bill-ready)
│   ├── context-panel.tsx             # right-side panel (PanelWalkIn / PanelSession / PanelBooked)
│   ├── order-panel.tsx               # legacy fallback panel (rare flows)
│   ├── walk-in-slider.tsx            # full-page slider for multi-table walk-in
│   ├── checkin-slider.tsx            # search + check-in drawer
│   ├── extend-modal.tsx              # extend running session
│   ├── stop-confirm-modal.tsx        # confirm stop
│   ├── finalize-bill-modal.tsx       # payment + bill collection
│   ├── pos-alerts.tsx                # toast-style alerts
│   ├── upcoming-drawer.tsx           # drawer panel showing upcoming bookings
│   ├── manual-booking-modal.tsx      # modal for manual bookings (used by owner too)
│   └── name-mismatch-modal.tsx       # warning modal for name/phone mismatches
├── owner/
│   ├── nav.tsx                       # dark sidebar nav (sign-out, refresh-on-nav)
│   └── dashboard-refresh.tsx
├── inventory/
│   ├── low-stock-nav-badge.tsx       # sidebar badge for low stock
│   ├── stock-alerts-bell.tsx         # stock alert popup trigger
│   └── stock-controls.tsx            # controls to adjust stock levels
├── public/
│   ├── splash-hero.tsx               # landing splash + location cards
│   ├── location-browse.tsx           # slot grid + cart sheet
│   └── booking-confirmation.tsx
├── sw-register.tsx                   # registers service worker client-side
└── ui/                               # shadcn primitives (Button, Dialog, etc.)

hooks/
└── use-now-sampled.ts                # throttled time sampling hook (e.g. 10s intervals)

lib/
├── supabase/{admin,server,client,types}.ts
├── realtime/subscriptions.ts         # POS realtime channel setup
├── billing/engine.ts                 # pure calculateBill function
├── validators/schemas.ts             # all Zod schemas
└── utils.ts                          # cn, formatCurrency, formatCountdown, etc.

store/
├── pos.ts                            # Zustand POS store
└── cart.ts                           # Zustand cart store (persisted)

middleware.ts                         # auth gating
ARCHITECTURE.md                       # ← this doc
CLAUDE.md                             # per-session project context
MIGRATIONS.sql                        # SQL to run in Supabase
```

---

## 5. Database schema (Postgres via Supabase)

14 tables. All have `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` and `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` unless noted.

### Core domain

#### `locations`
The two physical sites.

| Field | Type | Purpose |
|---|---|---|
| `name` | text | "Gamehaus Bandra" |
| `slug` | text | URL slug — `/{slug}` |
| `address`, `phone`, `timezone` | text | |
| `opening_time`, `closing_time` | `time` (HH:MM) | Business hours. Walk-in API + slot grid enforce these. Midnight-crossing supported. |
| `image_urls` | `text[]` | Multiple image URLs for the location landing/carousel |
| `is_active` | bool | Soft-hide |

#### `users` (Supabase Auth + `public.users` profile row)
| Field | Type | Purpose |
|---|---|---|
| `id` | uuid | Foreign-key to `auth.users.id` |
| `name`, `email` | text | |
| `role` | `'owner' \| 'staff'` | Drives POS vs owner panel access |
| `location_id` | uuid | Staff only — which location their POS is for |
| `is_active`, `login_password` | bool / text | |

> JWT claim `app_role` is set via a Supabase auth hook so middleware can read role without a DB query.

#### `tables`
Each playable surface — snooker, pool, PS5, foosball.

| Field | Type | Purpose |
|---|---|---|
| `location_id` | uuid | |
| `name`, `type`, `size`, `description`, `image_url` | text | `type: snooker \| pool \| ps5 \| foosball` |
| `hourly_rate` | numeric | Flat fallback rate |
| `people_pricing` | `jsonb` | Per-player or per-controller pricing. snooker/pool: `{"4":250,"5":300,"6":350}`. PS5: `{"1":400,"2":600}`. foosball: null |
| `sort_order`, `is_active` | int / bool | |

### Order lifecycle

#### `orders`
The umbrella for any single visit — online booking or walk-in. Items + extras + payments hang off this.

| Field | Type | Purpose |
|---|---|---|
| `location_id` | uuid | |
| `type` | `'online' \| 'walk_in'` | |
| `customer_name`, `customer_phone` | text | Phone is optional for walk-ins, required online |
| `status` | `'open' \| 'finalized' \| 'cancelled'` | |
| `coupon_id` | uuid | Set at order creation (validated server-side) |
| `subtotal`, `discount_amount`, `total_amount`, `amount_due` | numeric | Set at finalize |
| `advance_paid` | numeric | What Razorpay collected upfront (or 0 for walk-ins) |
| `points_redeemed` | int | Loyalty points spent on this order |
| `created_by` | uuid | Staff user for walk-ins; null for online |
| `finalized_at` | timestamptz | |

#### `order_items`
Per-table line for an order.

| Field | Type | Purpose |
|---|---|---|
| `order_id`, `table_id` | uuid | |
| `status` | `'scheduled' \| 'running' \| 'finished' \| 'cancelled'` | |
| `scheduled_start`, `scheduled_end`, `scheduled_duration_mins` | timestamptz / int | For online bookings (null for walk-ins) |
| `actual_start`, `actual_end`, `expected_end` | timestamptz | When the session actually ran |
| `extended_mins` | int | Cumulative extensions added |
| `rate_per_hour` | numeric | Frozen at order time (so future rate changes don't affect existing orders) |
| `final_amount` | numeric | Set at finalize |
| `is_deleted` | bool | Soft delete |

#### `order_extras`
Drinks/snacks added to a running session.

| Field | Type | Purpose |
|---|---|---|
| `order_id` | uuid | |
| `name`, `price`, `quantity` | text / numeric / int | |
| `cost_price` | numeric | Snapshotted from `inventory_items.cost_price` at sale time for profit reporting |
| `inventory_item_id` | uuid (nullable) | Links to catalogue. Null for custom items. |
| `is_deleted`, `added_by` | bool / uuid | |

#### `bookings`
Online reservations that are checked in at the POS.

| Field | Type | Purpose |
|---|---|---|
| `order_id`, `order_item_id` | uuid | |
| `scheduled_start`, `scheduled_end`, `held_until` | timestamptz | |
| `status` | `'confirmed' \| 'checked_in' \| 'no_show' \| 'cancelled'` | |
| `no_show_marked_by`, `no_show_marked_at` | uuid / timestamptz | |

#### `payments`
Audit trail of every payment row.

| Field | Type | Purpose |
|---|---|---|
| `order_id`, `amount`, `method` | uuid / numeric / `'cash' \| 'upi' \| 'card' \| 'razorpay'` | |
| `razorpay_order_id`, `razorpay_payment_id` | text | Set by webhook on capture |
| `status` | `'pending' \| 'completed' \| 'failed' \| 'refunded'` | |
| `collected_by`, `collected_at` | uuid / timestamptz | |

### Pricing & promotions

#### `coupons`
| Field | Purpose |
|---|---|
| `code` | uppercase, what customer types |
| `discount_type` | `'percent' \| 'flat'` |
| `discount_value` | percent (10 = 10%) or flat ₹ |
| `location_id` | nullable — null = all locations |
| `valid_from`, `valid_until` | UTC timestamps; full date window enforced |
| `max_uses`, `used_count` | usage cap (null = unlimited) |
| `is_active` | bool |

**Enforcement** lives in:
- [`/api/coupons/validate`](app/api/coupons/validate/route.ts) — live check used by checkout UI
- [`/api/orders`](app/api/orders/route.ts) — same rules re-applied server-side at order creation
- [`/api/orders/[id]/finalize`](app/api/orders/[id]/finalize/route.ts) — re-applied again at venue finalize (drops silently if invalid)

#### `membership_plans`
| Field | Purpose |
|---|---|
| `name`, `price`, `duration_days` | |
| `discount_pct`, `free_hrs` | Plan benefits |
| `is_active` | |

#### `customer_memberships`
Active assignments of a plan to a customer phone.
| Field | Purpose |
|---|---|
| `customer_phone`, `plan_id` | |
| `starts_at`, `expires_at` | |
| `free_hrs_used` | (not yet wired into billing) |
| `is_active` | |

> Discount applied in [`/api/orders/[id]/finalize`](app/api/orders/[id]/finalize/route.ts) **after** coupon and **before** points.

#### `customer_profiles`
Phone-keyed loyalty record. Auto-created on first order.
| Field | Purpose |
|---|---|
| `phone` | unique key |
| `name`, `visit_count`, `total_spent` | denormalized at finalize |
| `points_balance` | loyalty points: 1 point per ₹100 spent, 1 point = ₹1 redemption |
| `last_visit_at` | |

#### `inventory_items`
Per-location catalogue of drinks/snacks/accessories the staff can add to a bill. Includes stock management.
| Field | Purpose |
|---|---|
| `location_id`, `name`, `category` | |
| `selling_price`, `cost_price` | Profit = selling − cost; cost is snapshotted into `order_extras` at sale time |
| `image_url`, `sort_order`, `is_active` | |
| `stock_count` | Current stock level (decremented on extra sale, incremented on restock) |
| `low_stock_threshold` | Triggers warning in UI when stock_count <= this value |

#### `inventory_stock_logs`
Audit log of all stock adjustments (sales, manual adjustments, restocks).
| Field | Purpose |
|---|---|
| `inventory_item_id`, `location_id` | |
| `change` | Positive/negative delta applied |
| `reason` | 'restock' \| 'sale' \| 'adjustment' \| 'reverse' |
| `order_extra_id` | Nullable — links to sold order extra |
| `note`, `created_by` | Audit comment and staff actor |

#### `app_settings`
Global application settings stored as a single JSONB blob.
| Field | Purpose |
|---|---|
| `id` | Always 1 (enforced by CHECK constraint) |
| `data` | JSONB config object (e.g. `loyalty.earn_rupees_per_point`, `loyalty.redeem_rupees_per_point`) |
| `updated_at`, `updated_by` | Audit columns |

#### `table_availability_overrides`
Block specific dates/times for a table (e.g. maintenance day).

### Indexes added (in `MIGRATIONS.sql`)
```sql
idx_customer_memberships_phone
idx_customer_memberships_active_lookup(customer_phone, is_active, expires_at)
idx_inventory_items_location
idx_inventory_items_location_active   -- partial WHERE is_active
idx_order_extras_order_id
idx_inv_stock_logs_item               -- compound (inventory_item_id, created_at DESC)
idx_inv_stock_logs_loc                -- compound (location_id, created_at DESC)
idx_customer_profiles_lower_name      -- B-tree lower(name) text_pattern_ops for autocomplete
idx_customer_profiles_phone_prefix    -- B-tree phone text_pattern_ops for autocomplete
```

---

## 6. Routes

### Public
| Path | Server / Client | What |
|---|---|---|
| `/` | SSR | Landing splash + 2 location cards |
| `/[locationSlug]` | SSR + client | Table grid + slot picker. Prefetches today's blocked slots server-side. |
| `/[locationSlug]/book` | client | Cart + customer details + Razorpay payment |
| `/booking/[bookingId]` | SSR | Post-payment confirmation, copy-able booking ID |

### POS
| Path | Notes |
|---|---|
| `/pos` | Staff-only. Loads `POSScreen`. Subscribes to realtime. |

### Owner
All owner pages follow the same shape: `page.tsx` (server, admin-client prefetch) → `content.tsx` (client, TanStack Query with `initialData`) → optional `loading.tsx` skeleton.
| Path | Purpose |
|---|---|
| `/owner` | Dashboard — stat cards, 7-day revenue chart, live sessions, recent orders |
| `/owner/locations` | CRUD locations |
| `/owner/tables` | CRUD tables (incl. people_pricing JSON editor, image upload) |
| `/owner/inventory` | CRUD inventory items (cost/selling, category, image) |
| `/owner/staff` | Create staff accounts (Supabase Auth user + profile row) |
| `/owner/bookings` | Schedule + list view of all bookings; refund dialog |
| `/owner/customers` | Loyalty profiles, sort/filter, VIP/Regular badges |
| `/owner/memberships` | Plan CRUD + assign-to-customer dialog (`router.refresh` after) |
| `/owner/coupons` | Coupon CRUD + copy-to-clipboard |
| `/owner/reports` | Date-range reports: revenue, profit breakdown, payment methods, top customers |
| `/owner/settings` | (currently a placeholder) |

### Auth
| `/login` | Client form. After successful sign-in, prefetches `/owner` and `/pos` in parallel with the role lookup, then redirects. |

### API
See **§8 API endpoints** below.

---

## 7. Middleware (auth gating)

[`middleware.ts`](middleware.ts) runs on every request matching `((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)`.

Logic:
```
if pathname starts with /api/        → pass through (each route handles its own auth)
if pathname is public + not /login   → pass through (no auth touched)
else:
  read JWT → user
  if !user && requiresAuth (/owner/* or /pos)  → redirect /login?redirectTo=…
  if  user && pathname == /login                → redirect by role (/owner or /pos)
  if  user && pathname starts with /owner       → if role==staff, redirect /pos
```

Role read from JWT claim `app_role` (set via Supabase auth hook). Falls back to `role` for backwards compatibility.

---

## 8. API endpoints

All routes use `export const runtime = 'edge'`. All responses use `ok(data)` / `err(message, code)` from [`lib/validators/schemas.ts`](lib/validators/schemas.ts).

### Order lifecycle

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/orders` | admin (online) / staff (walk-in) | Create order + items + bookings. **Server-side conflict check** (slot overlap), **coupon validation** (active + dates + max_uses + location), customer_profile upsert |
| POST | `/api/orders/[id]/extras` | staff | Add extras row (with `cost_price` + `inventory_item_id` snapshot) |
| PATCH | `/api/orders/[id]/extras/[extraId]` | staff | Update quantity (used by the +/- stepper) |
| DELETE | `/api/orders/[id]/extras/[extraId]` | staff | Soft-delete extras row |
| POST | `/api/orders/[id]/finalize` | staff | Compute bill, apply coupon + membership + points, record payment, update customer profile, increment coupon usage, all in parallelized Promise.all |

### Walk-in (POS shortcut)

| POST | `/api/walkin` | staff | Combined endpoint — creates order + items in `running` state in one round trip. Enforces operating hours and slot-conflict check. |

### Bookings

| POST | `/api/bookings/[id]/checkin` | staff | Applies early/on-time/late rules (early shifts slot, late anchors to scheduled times). Rejects if table currently in use (early) or past scheduled_end. |
| POST | `/api/bookings/[id]/noshow` | staff | Marks no-show, cancels item, finalizes order with `amount_due=0` |
| POST | `/api/bookings/[id]/reschedule` | staff | Updates booking + order_item scheduled times in parallel |

### Sessions

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/sessions/start` | staff | Flip scheduled → running, set `actual_start = now` |
| POST | `/api/sessions/stop` | staff | Flip running → finished, set `actual_end = now` |
| POST | `/api/sessions/extend` | staff | Accepts both running AND finished items. Anchors new `expected_end` to current `expected_end` (not to "now") so brief staff delay doesn't shrink the add-on. Enforces next-booking gap + shop closing time. |
| POST | `/api/sessions/people` | staff | Change player/controller count mid-session. Re-resolves rate from table's `people_pricing` config on the server. |

### Payments

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/payments/create-order` | public | Calls Razorpay API to create an order, inserts pending payment row |
| POST | `/api/payments/webhook` | Razorpay (HMAC verified) | On capture: marks payment completed, sets `advance_paid`, awards loyalty points |
| POST | `/api/payments/demo-confirm` | public | Test path — bypasses Razorpay, marks payment completed |

### Promotions / loyalty

| GET | `/api/coupons/validate` | public | Live coupon check (active, dates, max_uses, location, computed discount) |
| GET | `/api/customers/lookup` | public/staff | Phone → loyalty profile |
| GET | `/api/memberships` | admin | List plans |
| POST | `/api/memberships` | owner | Create plan |
| PATCH | `/api/memberships/[id]` | owner | Update plan |
| DELETE | `/api/memberships/[id]` | owner | Soft-delete plan |
| POST | `/api/memberships/assign` | owner | Assign plan to a phone; deactivates any existing active membership for that phone |
| GET | `/api/memberships/customer?phone=X` | admin | Get active membership for a phone |

### Settings

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/settings` | admin | Retrieve global settings (loyalty earn/redeem rates, stock thresholds) |
| PATCH | `/api/settings` | owner | Update global settings |

### CRUD & Stock Management

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/POST | `/api/locations` | owner | List/create locations |
| POST | `/api/locations/upload` | owner | Image upload to `table-images` bucket |
| PATCH/DELETE | `/api/locations/[id]` | owner | Update/delete location |
| GET/POST | `/api/tables` | owner | List/create tables |
| PATCH/DELETE | `/api/tables/[id]` | owner | Update/delete table |
| POST | `/api/tables/upload` | owner | Image upload to `table-images` bucket |
| GET | `/api/tables/[id]/slots?date=YYYY-MM-DD` | public | Returns blocked time ranges for one table on one date |
| GET/POST | `/api/inventory` | owner | List/create inventory items |
| PATCH/DELETE | `/api/inventory/[id]` | owner | Update/delete inventory item |
| POST | `/api/inventory/upload` | owner | Image upload for inventory item |
| POST | `/api/inventory/[id]/stock` | owner | Add/adjust stock for inventory item (logs to stock audit trail) |
| GET | `/api/inventory/low-stock-count` | owner/staff | Get count of items below low-stock threshold |
| GET | `/api/inventory/low-stock-list` | owner | List items under low-stock threshold |
| POST | `/api/inventory/apply-default-threshold` | owner | Restores global default stock threshold to all items |
| GET/POST | `/api/staff` | owner | List/create staff accounts (includes auth user setup) |
| PATCH/DELETE | `/api/staff/[id]` | owner | Update/delete staff profiles |

### POS data feeds
| `/api/pos/tables?locationId=X` | List tables for a location |
| `/api/pos/orders?locationId=X` | Open orders + items + extras |
| `/api/pos/bookings?locationId=X` | Confirmed upcoming bookings |

---

## 9. State management

### Zustand: `usePOSStore` ([`store/pos.ts`](store/pos.ts))

Single source of truth for the POS UI. **Not persisted** — fresh on every reload.

```
State:
  now                : Date         ← ticked every 1s by POSScreen
  tables             : TableWithStatus[]
  openOrders         : POSOrder[]
  selectedOrderId    : string | null
  selectedTableId    : string | null
  walkInOpen / walkInPrefilledTableId / checkinOpen / upcomingDrawerOpen
  extendModalItem / stopConfirmItem / finalizeOrderId
  pointsToRedeem     : Record<orderId, points>
  openingTime / closingTime  : "HH:MM"

Actions:
  setX(...)                          ← simple setters (includes setUpcomingDrawerOpen)
  selectOrder(id)                    ← opens OrderPanel
  patchOrderItem(itemId, patch)      ← optimistic patch
  addOrderExtra / removeOrderExtra / patchOrderExtra   ← optimistic
  handleOrderItemChange / handleOrderChange / handleTableChange
                                     ← realtime payload handlers
```

#### How the realtime handlers work

When the Supabase realtime channel fires a `postgres_changes` event, the handler mutates the in-memory store directly so the UI reflects it without waiting for a TanStack Query refetch. The query refetch (5-min interval, or `invalidateQueries` on insert) is a safety net.

### Zustand: `useCartStore` ([`store/cart.ts`](store/cart.ts))

**Persisted to `localStorage` under `gamehaus-cart`**. Customer-side only.

```
State:
  locationId    : string | null
  items         : CartItem[]

Actions:
  setLocation(id)         ← clears cart if switching locations
  addItem(item)
  removeItem(tableId, scheduledStart)
  clearCart()
```

`CartItem` shape:
```ts
{
  tableId, tableName, tableType, ratePerHour, numPeople?,
  scheduledStart, scheduledEnd, durationMins, amount
}
```

### TanStack Query

**Global config** ([`components/providers.tsx`](components/providers.tsx)):
- `staleTime: 60 * 1000`
- `refetchOnWindowFocus: false`

**Key queries**:
| Query key | Where | Refetch interval | Stale time |
|---|---|---|---|
| `["pos-tables", locationId]` | POSScreen | 5 min | inherits |
| `["pos-orders", locationId]` | POSScreen | 5 min | inherits |
| `["pos-bookings", locationId]` | POSScreen | 5 min | inherits |
| `["inventory", locationId]` | PanelSession (lazy when picker opens) | — | 5 min |
| `["customer-lookup", phone]` | PanelSession + checkout | — | 60s |
| `["reports", from, to]` | reports content | — | 5 min |
| `["membership-plans"]` | memberships content | — | 5 min |

**Optimistic mutations** use the same pattern everywhere:
```
onMutate:
  cancel in-flight queries
  snapshot previous data
  patch cache
  close any open dialogs immediately
  return { prev } for rollback
onError(_, _, ctx):
  qc.setQueryData(key, ctx.prev)
onSettled:
  qc.invalidateQueries(key)  // re-sync from server
```

This pattern is used in: tables, inventory, locations, staff, coupons, memberships content files.

---

## 10. Components — what each one does

### POS components

#### [`pos-screen.tsx`](components/pos/pos-screen.tsx) (the shell)
- Mounts TanStack Query data feeds + Supabase realtime channel
- Owns the 1-second clock interval (writes `now` to the store)
- Renders the static frame: header (location name, walk-in button, sign-out), `<TableGrid>`, `<ContextPanel>`, `<POSAlerts>`
- **Lazy-loads** 6 overlays via `next/dynamic`: `OrderPanel`, `WalkInSlider`, `CheckinSlider`, `ExtendModal`, `StopConfirmModal`, `FinalizeBillModal` — they each have an outer gate that returns null when not opened, so the chunk only downloads when first triggered
- Sync `openingTime` and `closingTime` from server props into the store
- Does **not** subscribe to `now` itself (intentional — avoided 1Hz tree-wide rerenders); uses `Date.now()` inline where needed
- Build of table-card status from raw queries lives here (combines `rawTables`, `rawOrders`, `rawBookings` into `TableWithStatus[]`)

#### [`table-grid.tsx`](components/pos/table-grid.tsx)
The 2/3/4-column grid of table cards. Cards have four states:
- **`IdleCard`** — table free; "Tap to start" → opens PanelWalkIn
- **`BookedCard`** — upcoming booking within 30 min; shows Check-In + No-show buttons inline
- **`RunningCard`** — live session; shows customer, elapsed start time, "Left X:XX" or "-X:XX over" (red when over), progress bar, +15m / +30m extend, Stop (opens StopConfirmModal). Subscribes to `now`.
- **`BillReadyCard`** — session finished, awaiting collection; "Collect Bill" → opens FinalizeBillModal

`TableGrid` outer is `memo()`'d. Cards re-render only when their underlying `TableWithStatus` props change or (for RunningCard) on the per-second `now`.

#### [`context-panel.tsx`](components/pos/context-panel.tsx) (1241 lines — the biggest single file)
The 380-px right-side panel. Renders one of three subviews based on selected table state:

- **`PanelWalkIn`** — Customer name + 10-digit phone + duration picker (presets + erasable custom input). Live customer-profile lookup. Enforces operating-hours: disables Start button outside hours, caps duration at min(next-booking-gap, time-until-close). Calls `/api/walkin`.
- **`PanelSession`** — Live receipt for an active or bill-ready order. Subscribes to `now` for countdown. Shows session timings (start → expected end), live bill, extras section (gated catalogue with +/- stepper + custom item form), loyalty-points input, "Finalize & Collect" footer with +15/+30/+60 inline extend buttons (disabled if gap to next booking < that amount or shop closing).
- **`PanelBooked`** — *(rendered inline in BookedCard, not via this file)* — Check-in + No-show flows.

#### [`extend-modal.tsx`](components/pos/extend-modal.tsx)
Modal for extending a running session. **Outer gate** pattern — top component reads `extendModalItem` from store, returns null if unset; inner only mounts when an item is selected. Shows preset buttons (15/30/60) disabled when they'd exceed shop closing or next booking. Anchored to `expected_end`, never `now`.

#### [`stop-confirm-modal.tsx`](components/pos/stop-confirm-modal.tsx)
Confirm dialog before stopping a running session. Same outer-gate pattern.

#### [`finalize-bill-modal.tsx`](components/pos/finalize-bill-modal.tsx)
Bill collection: payment method (cash / UPI), points-redeem input, manual phone entry if order had none, final breakdown. Calls `/api/orders/[id]/finalize`.

#### [`walk-in-slider.tsx`](components/pos/walk-in-slider.tsx)
Full-page slider for multi-table walk-ins (legacy alternative to PanelWalkIn). Same outer-gate pattern.

#### [`checkin-slider.tsx`](components/pos/checkin-slider.tsx)
Search-by-phone-or-name + check-in drawer. Bypasses PanelBooked for ad-hoc check-ins.

#### [`order-panel.tsx`](components/pos/order-panel.tsx) (509 lines, rarely used)
Secondary order detail panel triggered from CheckinSlider / past-session history. Uses old grace-period UI. Kept for legacy paths.

#### [`pos-alerts.tsx`](components/pos/pos-alerts.tsx)
Toast-like alert area for overdue sessions or notable events.

#### [`upcoming-drawer.tsx`](components/pos/upcoming-drawer.tsx)
Drawer panel triggered from the header "Upcoming" button that shows today's upcoming bookings split into time bands ("Next 30 minutes" and "Later today").

#### [`manual-booking-modal.tsx`](components/pos/manual-booking-modal.tsx)
Dialog overlay used (primarily in owner panel bookings calendar view) to manually schedule and book slots for any table.

#### [`name-mismatch-modal.tsx`](components/pos/name-mismatch-modal.tsx)
A modal warning UI triggered when the customer phone lookup results in a profile name that mismatches the name typed during walk-in or checkout, offering staff or customers a way to overwrite or reconcile.

#### [`sw-register.tsx`](components/sw-register.tsx)
Client-side component embedded in layout to register the Service Worker (`/sw.js`) in production, enabling offline asset and page caching.

### Owner components

#### [`nav.tsx`](components/owner/nav.tsx)
Dark 240px left sidebar.
- Lists every owner route, highlights active
- **Prefetches all owner routes on mount** (`router.prefetch` for the JS chunks + RSC payloads)
- **Refreshes on every pathname change** (`router.refresh`) so cross-page mutations show up immediately. Skips the very first mount. Throttled to ≥5s between refreshes.
- **Refreshes on tab focus** (`visibilitychange`) so coming back to the tab after activity elsewhere shows fresh data. Same throttle.
- Sign-out: 700ms overlay → `supabase.auth.signOut()` → redirect to `/login`
- Back-button: confirms before leaving owner panel

#### [`dashboard-refresh.tsx`](components/owner/dashboard-refresh.tsx)
Tiny client island in the dashboard server component — triggers periodic `router.refresh()` so live stats stay current.

### Public components

#### [`splash-hero.tsx`](components/public/splash-hero.tsx)
Landing page splash animation + two location cards.

#### [`location-browse.tsx`](components/public/location-browse.tsx) (817 lines)
The slot picker.
- Date strip (today + 6 days)
- Type filter chips (All / Snooker / Pool / PS5 / Foosball)
- Table cards grid
- Booking sheet (slides up on table tap) — players/controllers selector if `people_pricing` is set, 15-min slot grid with multi-select, live total, "Add to Cart"
- Cart count badge → `/[locationSlug]/book`
- **Realtime sub** to `order_items` + `bookings` for this location's tables; bumps `slotsTick` to force grid refresh
- **router.refresh on mount + visibilitychange** to bust Next.js router cache when returning

#### [`booking-confirmation.tsx`](components/public/booking-confirmation.tsx)
Success page after Razorpay handler fires. Shows order summary + booking IDs + cancel link (within window).

---

## 11. Core business logic

### Slot booking flow

```
Customer on /[locationSlug]
  → server pre-fetches today's blocked slots into initialSlots prop
  → LocationBrowse subscribes to realtime (order_items + bookings)
  → Customer taps a table → booking sheet opens
  → For each 15-min slot:
       isServerBlocked = overlap with any existing order_item (running/scheduled) OR confirmed booking
       isCartOccupied  = overlap with any item already in cart
  → Multi-select slots within available range
  → Add to Cart → cart persists to localStorage
  → Navigate to /[locationSlug]/book

On /[locationSlug]/book
  → Cart items shown; expired items flagged (slot start has passed)
  → Customer enters name (letters only) + 10-digit phone
  → Customer enters coupon (live-validated via /api/coupons/validate)
  → Selects payment mode (Advance ₹100/table OR Full payment)
  → Coupon discount only applies in Full mode
  → Razorpay checkout opens; on handler → redirect to /booking/[id]
```

### Slot-blocking algorithm (server side)

`/api/tables/[id]/slots?date=YYYY-MM-DD` returns blocked `{start, end}` ranges by:
1. Query `order_items` where `is_deleted=false` and `status IN (running, scheduled)`
2. Query `bookings` where `status='confirmed'` filtered by date range
3. Post-filter `order_items` in-code by date — for `running` items use `actual_start`, for `scheduled` use `scheduled_start`. (We can't pre-filter SQL on `scheduled_start` because walk-ins have NULL there and would be excluded.)
4. Combine into blocked ranges, dedupe by start time

### Check-in flow (online booking → live session)

`/api/bookings/[id]/checkin` rules:
```
now = current time

if now >= scheduled_end:
  reject: "expired, mark as no-show"

if now < scheduled_start:                    # EARLY arrival
  if table has any other running item:
    reject: "table currently in use"
  actual_start = now
  expected_end = now + booked_duration       # slot SHIFTS earlier

else:                                         # ON-TIME or LATE
  actual_start = scheduled_start              # anchor to booked time
  expected_end = scheduled_end                # late = less play, full bill
```

### Walk-in flow

`/api/walkin` creates order + items already in `running` state in one round-trip. Enforces:
- Operating hours (today's shop window, midnight-cross supported)
- Duration ≤ time-until-close
- No slot conflicts with existing items or confirmed bookings on the same table

### Session lifecycle

```
scheduled (online only)
  ↓ /api/sessions/start or /api/bookings/[id]/checkin
running
  ↓ /api/sessions/stop (or staff hits Stop)
finished                          ← bill-ready state
  ↓ /api/sessions/extend (allowed on finished too — resurrects)
running again, with new expected_end
  ...
  ↓ /api/orders/[id]/finalize
order.status = finalized          ← terminal
```

### Billing engine ([`lib/billing/engine.ts`](lib/billing/engine.ts))

Pure function `calculateBill(items, extras, now, coupon?, advancePaid?)`. Returns `{ tableLines, extraLines, subtotal, discountAmount, advancePaid, totalDue }`.

**Slot-based billing** — for each item:
```
durationMins  = (expected_end - actual_start) / 60s    ← billed duration
amount        = (durationMins / 60) * rate_per_hour
```

For online bookings checked in late, `actual_start` is anchored to `scheduled_start` so the customer pays the full booked slot even though they played less.

For walk-ins, the customer pays the chosen duration regardless of when they stop. Stopping early doesn't reduce the bill.

**Extension** adds to `expected_end` only — never back-dates.

**No overtime billing.** Past `expected_end`, the bill is locked. UI shows a red "-MM:SS over" countdown. Staff must manually stop or extend.

**Coupon discount** is computed against `subtotal` (table + extras). Clamped to ≤ subtotal. Applied before advance subtraction.

### Finalize ([`/api/orders/[id]/finalize`](app/api/orders/[id]/finalize/route.ts))

Order of operations (all DB round-trips parallelized):
```
1. Fetch order + items + extras + (optional) coupon-by-code in parallel
2. Re-validate coupon against full rule set (active, dates, max_uses, location); drop if invalid
3. calculateBill(items, extras, now, coupon, advance_paid) → bill.totalDue
4. Look up membership (if phone known) + points balance, in parallel
5. Apply membership: billAfterMembership = bill.totalDue - (totalDue * discount_pct / 100)
6. Apply points: finalDue = billAfterMembership - clampedPoints
7. Compute pointsEarned = floor(finalDue / 100)
8. Run 4 writes in parallel:
   - Update order (status=finalized, amount_due, points_redeemed, finalized_at, coupon_id)
   - Insert payments row
   - Increment coupon used_count (if any)
   - Fetch customer profile
9. Update or insert customer_profile (visit_count, total_spent, points_balance, last_visit_at)
```

### Loyalty points

- Earned at finalize: `floor(finalDue / 100)`. So spending ₹500 earns 5 points.
- Earned for online orders also via Razorpay webhook on capture: `floor(payment.amount / 100)`, net of any redemption that was already applied.
- Redeemed at finalize: input clamped to `min(balance, floor(billAfterMembership))`.

### Membership

Customer is identified by phone. Active membership = `is_active=true AND expires_at >= now`.

Applied at finalize **after coupon, before points**: `billAfterMembership = bill.totalDue × (1 - discount_pct/100)`.

`free_hrs` field exists in schema but is **not yet wired** into billing — only `discount_pct` is honoured.

### Coupon validation (4 enforcement points)

1. **`/api/coupons/validate`** — live check from checkout UI as customer types
2. **`/api/orders` (creation)** — server re-validates and attaches `coupon_id` to order
3. **`/api/orders/[id]/finalize`** — re-validates one more time; silently drops if invalid
4. **`coupons.used_count` increment** — happens in finalize, after the order is committed

Rules (all enforced in all 3 server paths):
```
is_active = true
valid_from ≤ now ≤ valid_until
max_uses IS NULL OR used_count < max_uses
location_id IS NULL OR location_id = order.location_id
```

---

## 12. Realtime architecture

### Staff side — [`lib/realtime/subscriptions.ts`](lib/realtime/subscriptions.ts)

`subscribeToPOS(locationId, handlers)` opens **one channel** `pos-{locationId}` with these listeners:
| Table | Event | Action |
|---|---|---|
| `order_items` | `*` | Direct in-memory mutation via `handleOrderItemChange` |
| `orders` | `*` (filter `location_id`) | `handleOrderChange` + `onInsert` invalidates queries |
| `bookings` | `INSERT` | `onInsert` invalidates `pos-bookings` query |
| `tables` | `*` (filter `location_id`) | `handleTableChange` |
| `order_extras` | `*` | `onExtrasChange` invalidates `pos-orders` |

This means a customer's online booking surfaces on the POS within ~1s of payment, and another staff member's actions show up instantly across both staff browsers at the same location.

### Customer side — `LocationBrowse`

One channel `public-slots-{locationId}` listening to `order_items` and `bookings` events for the current location's tables (filtered client-side). On any relevant change → bumps `slotsTick` state → forces a re-fetch of `/api/tables/[id]/slots` for whichever sheet is open AND bypasses the stale `initialSlots` cache for future sheet opens.

### What the realtime + router.refresh combo guarantees

- Staff side: any DB change is reflected within 1 RTT
- Customer side: any change while the page is mounted is reflected within 1 RTT; when navigating back to the page, `router.refresh()` re-runs the server component for fresh initial data
- Owner side: same `router.refresh()` on path-change + tab-focus pattern in `OwnerNav` (throttled to ≥5s)

---

## 13. Payment flow (Razorpay)

```
Customer fills checkout form, clicks Pay
  ↓ POST /api/orders
Server: validate slot conflicts + coupon → create order + items + bookings
  ↓ POST /api/payments/create-order { amount, order_id }
Server: call Razorpay /v1/orders API → insert pending payment row → return razorpay_order_id
  ↓
Client: window.Razorpay(options).open() → Razorpay checkout UI overlays
  ↓ Customer pays
Razorpay → webhook → POST /api/payments/webhook (HMAC verified)
Server: mark payment.status = completed
        update order.advance_paid = payment.amount
        award loyalty points (floor(amount / 100) − points_redeemed)
        (all in parallel)
  ↓ Razorpay handler (client-side): redirect to /booking/[order_id]?payment_id=…
```

The handler redirects optimistically — the webhook is the source of truth for `payment.status`. If webhook hasn't fired yet by the time confirmation page loads, the page still works (it reads the order, not the payment row).

For testing without Razorpay: `/api/payments/demo-confirm` directly creates a completed payment row. Wired to the "Demo Pay" button on checkout.

---

## 14. Auth flow

```
User → /login
  ↓ POST credentials → supabase.auth.signInWithPassword
  ↓ Supabase sets HTTP-only cookies (sb-access-token, sb-refresh-token)
  ↓ Client: SELECT role FROM public.users WHERE id = auth.uid()
  ↓ Client: router.prefetch /owner and /pos in parallel
  ↓ router.replace('/owner') if owner, '/pos' if staff
```

On every subsequent request, middleware:
1. Reads cookies → gets user
2. Parses JWT → extracts `app_role` claim
3. Enforces role-based redirects (staff → /pos, owner → /owner)

Sign-out: 700ms overlay (so user sees the transition) → `supabase.auth.signOut()` → `router.replace('/login')`.

---

## 15. Performance optimizations applied

Documented for future reference. None of these are speculative — each was triggered by a measured pain point.

### Rendering
- **POSScreen does not subscribe to `now`** — Otherwise the entire POS tree (10+ tables, 6 modals, 3 panels) re-evaluated every 1000ms. Uses `Date.now()` inline where needed.
- **Modals/sliders are gated** — Each overlay has an outer component that subscribes only to its open-state boolean; inner subscriptions (`tables`, `now`, etc.) only run when visible.
- **Modals are `next/dynamic`** in `pos-screen.tsx` — Six overlays load on demand. Saved ~20 KB on /pos first-load.
- **Reports computations memoized** — Single pass over `filteredOrders`, not 5 separate loops on every render.
- **Optimistic updates everywhere** — All hot-path actions (stop, extend, start, add/remove extras, owner toggles) update the cache/store first, then fire the API. Reverts on error.

### Network
- **POS queries use 5-min `refetchInterval`** — Realtime is reliable; polling is a safety net only.
- **TanStack staleTime defaults to 60s**, with `refetchOnWindowFocus: false`.
- **Parallel DB calls** in API routes — `/api/orders` creates order + items + bookings + customer profile upsert all in parallel.
- **`/api/orders/[id]/finalize` parallelizes 4 writes** — order update, payment insert, coupon increment, customer profile fetch.
- **Server-side slot prefetch** on `/[locationSlug]/page.tsx` — initialSlots prop passed to client; eliminates first-paint API call.
- **DB indexes** on `customer_memberships(phone, is_active, expires_at)`, `order_extras(order_id)`, `inventory_items(location_id, is_active)`.

### Navigation
- **OwnerNav prefetches every owner route on mount** — `router.prefetch` warms both JS chunks and RSC payloads.
- **Login prefetches /owner and /pos in parallel** with the role lookup (after auth succeeds, not before — otherwise the prefetches hit middleware redirects and Vercel returns 502).
- **OwnerNav refreshes on route change + tab focus** (throttled ≥5s).
- **LocationBrowse refreshes on mount + tab focus** to bust router cache after walk-ins.

### Bundle
- **Lucide icons are tree-shaken** via named imports.
- **`next/image`** everywhere for table + inventory photos — automatic WebP, responsive sizing, lazy load.
- **Dead code purged** — `bottom-bar.tsx`, `table-sessions-drawer.tsx`, `use-auto-stop.ts`, `use-auto-extend.ts` were all unreferenced.

### Auth
- **JWT claim `app_role`** is set via Supabase auth hook so middleware doesn't query `public.users` on every protected request.

---

## 16. Known limitations / wishlist

Honest list of things that exist but aren't ideal:

1. **`/login` is 163 KB** — mostly `@supabase/ssr`. Can't fix without dropping auth.
2. **Owner pages cluster at ~200 KB** — mostly shared deps. Per-page dialog lazy-loading would save 1-2 KB each, not worth the refactor across 5+ pages.
3. **`free_hrs` on membership plans not honoured** — schema exists, billing engine doesn't subtract.
4. **`order_panel.tsx` is legacy** — duplicates much of `context-panel.tsx` for less common flows (post-checkin OrderPanel view, session history). Could be consolidated.
5. **`GRACE_MINS = 5`** still exported from billing engine for OrderPanel's benefit. Dead in the main flow.
6. **WhatsApp Notification Integration** — confirmations are sent automatically via the Meta WhatsApp Cloud API. Dynamic cancellation button in template references the order.
7. **No customer cancellation enforced on the back end** — `/api/bookings/[id]/cancel` doesn't exist yet. Cancellation happens by phone or staff side.
8. **Loyalty points double-award guard** — if the webhook fires AND the finalize runs both award points. Currently safe because the webhook subtracts `points_redeemed` and finalize awards based on `finalDue`. But if logic changes, recheck.

---

## 17. WhatsApp Notification Flow

WhatsApp notifications are sent automatically upon order confirmation (either online payment capture via Razorpay webhook or staff demo checkout).

### Template Rules & Parameters:
- **Fully Paid Confirmation**:
  - Sent when the booking has zero balance due (`advance_paid >= net_cost`).
  - Template: `nerfturf_booking_confirmation` or `gamehaus_booking_confirmation`
  - Parameters (5): Customer Name, Booking Reference ID, Date, Table/Slot info, Amount Paid.
  - Interactive Action: A dynamic URL button **"Cancel Booking"** that passes the order's UUID (`orderId`) to dynamic templates.
- **Partial/Advance Reservation**:
  - Sent when the booking has an outstanding balance due.
  - Template: `nerfturf_table_reservation` or `gamehaus_table_reservation`
  - Parameters (6): Customer Name, Booking Reference ID, Date, Table/Slot info, Amount Paid, Amount Due.

---

*Last updated to reflect commit `13505bc` (booking confirmations & image upload fixes).*
