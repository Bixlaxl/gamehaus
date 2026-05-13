# Gamehaus — Project Reference

## Overview
Snooker & gaming café booking + POS system. Two physical locations (Bandra, Andheri). Built for owners to manage tables/staff and for customers to book online or walk in.

**Deployed on Vercel. Backend on Supabase.**

---

## Tech Stack
- **Framework**: Next.js 14 App Router (`app/` directory)
- **Database + Auth**: Supabase (PostgreSQL + RLS + Realtime)
- **State**: Zustand (cart: `persist` to localStorage; POS: in-memory with realtime)
- **Server state**: TanStack Query (POS data fetching, 30s refetch interval)
- **Payments**: Razorpay (create-order → checkout UI → webhook confirms)
- **Styling**: Tailwind CSS + shadcn/ui components
- **Theme**: next-themes (light/dark, `dark` class on `<html>`)
- **Validation**: Zod schemas in `lib/validators/schemas.ts`
- **Testing**: Vitest

---

## Roles
| Role | Access |
|------|--------|
| `owner` | `/owner/*` — manage locations, tables, staff, coupons, reports |
| `staff` | `/pos` — POS screen for their assigned location |
| Public | `/`, `/[locationSlug]`, `/[locationSlug]/book`, `/booking/[id]` |

Auth flows through Supabase + middleware (`middleware.ts`). JWT role claim used for redirect logic.

---

## Database Tables

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `locations` | id, name, slug, address, phone, opening_time, closing_time, timezone, is_active | Two locations |
| `users` | id, name, email, role, location_id | staff has location_id, owner has null |
| `tables` | id, location_id, name, type, hourly_rate, sort_order, is_active | type: snooker/pool/ps5/foosball |
| `orders` | id, location_id, type, customer_name, customer_phone, status, advance_paid, points_redeemed | type: walk_in/online, status: open/finalized/cancelled |
| `order_items` | id, order_id, table_id, status, actual_start, actual_end, expected_end, rate_per_hour | status: scheduled/running/finished/cancelled |
| `order_extras` | id, order_id, name, price, quantity, is_deleted | Beverages/drinks added during session |
| `bookings` | id, order_id, order_item_id, scheduled_start, scheduled_end, status | Online reservation rows, checked in at POS |
| `payments` | id, order_id, amount, method, status, razorpay_order_id, razorpay_payment_id | method: cash/upi/card/razorpay |
| `coupons` | id, code, discount_type, discount_value, is_active, used_count | percent or flat discount |
| `table_availability_overrides` | id, table_id, date, is_closed | Block specific dates |
| `customer_profiles` | id, phone (unique), name, visit_count, total_spent, last_visit_at, **points_balance** | points_balance added — loyalty system |

### Recent DB Migrations (run manually in Supabase)
```sql
ALTER TABLE customer_profiles ADD COLUMN points_balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN points_redeemed INTEGER NOT NULL DEFAULT 0;
```

---

## Key Architecture Patterns

### API Routes
- All admin mutations use `createAdminClient()` (service role, bypasses RLS)
- Public-facing queries (online booking) use admin client too since customers aren't logged in
- Walk-in/POS mutations require staff auth via `createClient()` first, then use admin for writes
- All API responses: `ok(data)` / `err(message, code)` from `lib/validators/schemas.ts`

### Cart (Public Booking)
- Zustand `persist` → localStorage key `"gamehaus-cart"`
- `setLocation()` clears cart when switching between locations
- `CartItem` holds tableId, slot times, duration, amount

### POS Store
- Zustand in-memory (no persistence)
- Single `now: Date` updated every 1 second — all timers derive from this
- Realtime: Supabase channel `"pos-{locationId}"` subscribes to `order_items`, `orders`, `tables`
- `handleOrderItemChange`, `handleOrderChange`, `handleTableChange` keep store in sync
- **Optimistic actions**: `patchOrderItem(itemId, patch)`, `addOrderExtra(orderId, extra)`, `removeOrderExtra(orderId, extraId)` — update store immediately, no server wait, revert on API error

### Billing Engine (`lib/billing/engine.ts`)
- Pure function `calculateBill(items, extras, now, coupon?, advancePaid?)`
- Called every second on POS for live preview; once at finalize
- Points discount applied OUTSIDE `calculateBill` — in finalize route after `totalDue` is computed
- Exports `GRACE_MINS = 5` and `OT_BLOCK_MINS = 15` (used by table-grid and order-panel)
- `BillingLineItem` has `billedOTMins` field: 0 during grace, rounds up to 15-min blocks after

### OT / Grace / Auto-extend
- 5-min grace period after `expected_end`: free, no charge, "Grace" badge shown
- After grace: charged in 15-min blocks (1 block = 15 mins at table rate)
- **Auto-extend** (`hooks/use-auto-extend.ts`): fires automatically when a block threshold is crossed, no user action needed
  - Skips tables that have an upcoming booking (`upcomingBooking` on `TableWithStatus`)
  - Three refs prevent duplicates: `blocksHandled`, `lastSeenExpectedEnd` (resets counter when DB updates `expected_end`), `inFlight`
  - Grace resets after each auto-extend (new `expected_end` moves 15 min forward)
- Tables **with** next booking are blocked from auto-extend; staff must manually stop

### Customer Lookup
- **POS walk-in**: debounced lookup after ≥6 digits typed — phone only, no name required, auto-fills name if field empty
- **Website checkout**: requires full Indian phone (10 digits, starts with 6/7/8/9) AND matching name before showing points balance; no name auto-fill

---

## Pages & Components

### Public
| Path | Component | Description |
|------|-----------|-------------|
| `/` | `components/public/splash-hero.tsx` | Landing page with splash animation + location cards |
| `/[locationSlug]` | `components/public/location-browse.tsx` | Table listing, 15-min slot multi-select booking |
| `/[locationSlug]/book` | `app/(public)/[locationSlug]/book/page.tsx` | Checkout — Razorpay payment |
| `/booking/[bookingId]` | `components/public/booking-confirmation.tsx` | Post-payment confirmation |

### POS (Staff)
| Component | Description |
|-----------|-------------|
| `components/pos/pos-screen.tsx` | Root POS layout — loads data, sets up realtime |
| `components/pos/table-grid.tsx` | Left sidebar — table list with live status |
| `components/pos/order-panel.tsx` | Right panel — selected order details, extras, bill |
| `components/pos/bottom-bar.tsx` | Bottom bar — New Walk-in, Check-in, Upcoming |
| `components/pos/walk-in-slider.tsx` | Slide-in panel for new walk-in entry |
| `components/pos/checkin-slider.tsx` | Slide-in panel for online booking check-in |
| `components/pos/finalize-bill-modal.tsx` | Payment + bill finalization modal |
| `components/pos/extend-modal.tsx` | Extend running session dialog |
| `components/pos/upcoming-drawer.tsx` | Upcoming bookings drawer |
| `components/pos/pos-alerts.tsx` | Alert banner for overtime etc. |

### Owner
| Path | Description |
|------|-------------|
| `/owner` | Dashboard overview |
| `/owner/tables` | CRUD tables per location |
| `/owner/locations` | Edit location details |
| `/owner/staff` | Create/manage staff accounts |
| `/owner/bookings` | View all bookings |
| `/owner/coupons` | Create/manage discount coupons |
| `/owner/reports` | Revenue reports |
| `/owner/settings` | App settings |

---

## API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/orders` | admin client | Create order (walk-in or online) |
| POST | `/api/orders/[id]/finalize` | staff | Stop sessions, calculate bill, record payment |
| POST | `/api/orders/[id]/extras` | staff | Add beverage/extra to order |
| DELETE | `/api/orders/[id]/extras/[extraId]` | staff | Remove extra |
| POST | `/api/sessions/start` | staff | Start a table session |
| POST | `/api/sessions/stop` | staff | Stop a running session |
| POST | `/api/sessions/extend` | staff | Extend expected end time |
| POST | `/api/bookings/[id]/checkin` | staff | Check in an online booking |
| POST | `/api/bookings/[id]/noshow` | staff | Mark no-show |
| POST | `/api/payments/create-order` | public | Create Razorpay order |
| POST | `/api/payments/webhook` | Razorpay | Confirm payment, update advance_paid |
| GET/POST | `/api/locations` | owner | List/create locations |
| PUT/DELETE | `/api/locations/[id]` | owner | Update/delete location |
| GET/POST | `/api/tables` | owner | List/create tables |
| PUT/DELETE | `/api/tables/[id]` | owner | Update/delete table |
| POST | `/api/staff` | owner | Create staff account |

---

## Completed Features

### Landing Page (`/`)
- [x] Splash screen animation: loading → enter → hold → exit → gone phases
- [x] Timing: hold 300ms, exit 1400ms, gone 2100ms (fast)
- [x] Curtain lift uses expo-out easing (1100ms, smooth)
- [x] Theme toggle (light/dark) — sun/moon icon
- [x] Admin button → proper pill button, black/white hover, reacts to theme
- [x] Theme toggle button — same black/white hover pattern
- [x] Header logo: `w-14 h-14 sm:w-20 sm:h-20` (responsive, smaller on mobile)
- [x] Location cards redesigned as full-card buttons (whole card is clickable)
  - Black bg / white hover in light mode, white bg / black hover in dark mode
  - Shows name, address, hours, open/closed badge, chevron
  - Accent colour bar at top (orange for location 1, green for location 2)
  - Active press feedback (scale)
- [x] Admin link: shows Loader2 spinner while navigating to /login
- [x] **Mobile optimized**: tighter padding on small screens (px-4 → px-5 at sm:), reduced hero padding

### Login Page (`/login`)
- [x] Spinner inside sign-in button during auth
- [x] Black/white hover on sign-in button

### Public Booking (`/[locationSlug]`)
- [x] Table cards with type icons
- [x] 15-minute slot grid (range display: 9:00→9:15)
- [x] Multi-select slots (click to extend/shrink selection, stops before occupied slots)
- [x] Slot filtering: shows from current time (not from opening time)
- [x] Midnight-crossing locations handled (e.g. 11 PM–2 AM)
- [x] Occupied slots (green checkmark, non-interactive) block booked ranges
- [x] Cart with slot range, duration, amount — persisted to localStorage
- [x] Cart isolated per location (switching locations clears cart)
- [x] **Mobile optimized**: slot grid `grid-cols-2 sm:grid-cols-3` (2 cols on phones), booking sheet padding tighter on mobile

### Checkout (`/[locationSlug]/book`)
- [x] Cart summary with cart item delete
- [x] Customer name + phone fields
- [x] Payment mode: Advance (₹100/table) or Full payment
- [x] Coupon code field (full payment mode)
- [x] Razorpay integration (create-order → checkout UI → handler) — loaded via `<Script strategy="lazyOnload">` to avoid preload warning
- [x] Order creation + bookings rows on payment

### POS Screen (`/pos`)
- [x] Real-time table status via Supabase Realtime
- [x] Table grid: idle / running (green border) / booked (amber border) / grace (amber, 5-min free window) / overtime (red, animated)
- [x] Running table shows: customer name, elapsed timer (42:17), countdown (05:23 left), live bill
- [x] Idle table tap → opens Walk-in slider pre-filled with that table
- [x] Running table tap → selects order in right panel
- [x] Foosball icon fixed (⚽)
- [x] Walk-in slider: customer name (auto-focus), phone, table multi-select, duration presets (30m/1h/1.5h/2h + custom); session starts fire in **parallel** (Promise.all, not sequential)
- [x] Walk-in creates order + immediately starts all sessions
- [x] Check-in slider: search by name/phone, check in confirmed bookings
- [x] Order panel: active sessions with stop/extend, extras (add/delete), bill summary; Grace badge during 5-min grace window
- [x] Extend modal: +30m, +60m, custom mins (respects 10-min buffer for upcoming bookings); closes **instantly** with optimistic countdown update
- [x] Finalize bill modal: bill breakdown, payment method (cash/upi/card), collect; handover flow if a next booking exists on the freed table
- [x] Upcoming bookings drawer
- [x] Back-button protection (confirm before leaving POS)
- [x] Sign out in header
- [x] **Optimistic UI on all POS actions**: stop session, start session, extend session, add extra, delete extra — UI updates on tap, reverts on API error

### Owner Panel (`/owner/*`)
- [x] Table CRUD (create, edit, toggle active, delete)
- [x] Location management
- [x] Staff creation (Supabase Auth user + users row)
- [x] Bookings view
- [x] Coupon management
- [x] Revenue reports
- [x] **Dark left sidebar nav** — replaced top nav; 240px fixed sidebar, orange active state, initials avatar, sign out at bottom
- [x] **Dashboard overview** — 4 stat cards (Today Revenue with ↑/↓ % vs yesterday, Live Tables, Bookings Today, Month Revenue); 7-day revenue bar chart (pure CSS, no library); Live Now panel (running tables with customer, elapsed, rate); Recent 8 orders table
- [x] **Optimistic UI across all owner pages** — toggle/deactivate/reactivate/delete update instantly, dialogs close immediately; edit forms close on submit with optimistic cache patch; all roll back cleanly on API error

---

## Loyalty / Royalty Points System — COMPLETE

### Business Rules
- ₹100 spent = 1 point earned
- 1 point = ₹1 discount (redeemable, partial — customer/staff chooses amount)
- Points credited: at payment confirmation (finalize for walk-in, webhook for online)
- Customer identified by **phone number** (primary key in `customer_profiles`)
- New customer → auto-created in `customer_profiles` on first order

### DB
- [x] `customer_profiles.points_balance INTEGER DEFAULT 0`
- [x] `orders.points_redeemed INTEGER DEFAULT 0`

### Backend
- [x] `GET /api/customers/lookup?phone=xxx` — returns `{ found, customer: { name, points_balance, visit_count, total_spent } }`
- [x] `POST /api/payments/demo-confirm` — bypass Razorpay for testing (marks payment completed, awards points)
- [x] `lib/supabase/types.ts` — `points_balance` on customer_profiles, `points_redeemed` on orders (Row/Insert/Update)
- [x] `lib/validators/schemas.ts` — `points_redeemed?: number` in `createOrderSchema` and finalize schema
- [x] `POST /api/orders` — stores `points_redeemed` on order creation
- [x] `POST /api/orders/[id]/finalize` — validates points against balance, clamps, applies discount, awards earned points, updates customer_profiles
- [x] `POST /api/payments/webhook` — awards points after Razorpay `payment.captured` event

### POS
- [x] Walk-in slider: debounced phone lookup (600ms after ≥6 chars), shows "X pts · N visits" amber badge, auto-fills name if field empty
- [x] POS store: `pointsToRedeem: Record<string, number>` + `setPointsToRedeem(orderId, points)`
- [x] Finalize bill modal: fetches customer points on open, shows balance, redemption input (clamped to min(balance, totalDue)), live total update, points-to-earn preview, passes `points_redeemed` to API

### Online Checkout
- [x] Phone field: debounced lookup → amber badge "X points available (₹X off)"
- [x] Points redemption input appears when customer has balance (clamped to min(balance, baseAmount))
- [x] Points discount line in summary
- [x] `points_redeemed` passed to order creation
- [x] **Demo Pay button** — skips Razorpay, calls `/api/payments/demo-confirm`, redirects to confirmation

### Points Flow Summary
```
Walk-in finalize:
  bill.totalDue → subtract clampedRedeem → finalDue
  pointsEarned = floor(finalDue / 100)
  customer.points_balance += pointsEarned - clampedRedeem

Online (webhook):
  paymentRow.amount → pointsEarned = floor(amount / 100)
  netPoints = pointsEarned - order.points_redeemed
  customer.points_balance += netPoints
```

---

## Known Patterns & Gotchas

- **RLS bypass**: All writes go through `createAdminClient()` in API routes. Browser client hits RLS and will silently fail on protected tables.
- **Next.js caching**: Admin client uses `cache: "no-store"` in global fetch to prevent stale data.
- **Slot time math**: Midnight-crossing locations (e.g. 23:00–02:00) need 3-case logic for `curMins`.
- **`active:` on divs**: CSS `:active` pseudo-class works on div children of `<a>` tags in browsers.
- **Tailwind dark: prefix**: Works because next-themes adds `dark` class to `<html>`. Use this for theme-reactive styles instead of JS `isDark` variable where possible.
- **Walk-in start flow**: Creates order → fetches `order_item` IDs by `order_id` + `table_id` → calls `/api/sessions/start` per table in **parallel** (`Promise.all`).
- **Billing**: `calculateBill()` is pure, called every second. Points discount applied after it returns, in the finalize route.
- **Optimistic updates pattern**: All fast mutations (toggle, stop, start, extend, add/delete extra) update Zustand store or TanStack Query cache immediately, then fire the API. On error, revert to previous state. On success, `invalidateQueries` for a fresh sync.
- **Owner panel optimistic pattern**: Uses TanStack Query `onMutate` → cancel in-flight queries → snapshot previous data → patch cache → return `{ prev }` for rollback in `onError`. `onSettled` always invalidates for a fresh sync.
- **formatElapsed** in `lib/utils.ts` — computes elapsed from `actual_start`.
- **Razorpay script**: Use `<Script strategy="lazyOnload">` from `next/script`, NOT a plain `<script>` tag — plain tags cause a preload warning because Next.js preloads the script but it isn't used within a few seconds on page load.
- **Mobile breakpoint**: Tailwind `sm:` = 640px. Phones are typically < 640px, tablets/desktops are ≥ 640px. Use `sm:` prefix to widen layouts at tablet and above.

---

## Environment Variables Needed
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
NEXT_PUBLIC_RAZORPAY_KEY_ID
```
