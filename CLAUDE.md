# Gamehaus — Project Reference

## Overview
Snooker & gaming café booking + POS system. Two physical locations (Bandra, Andheri). Built for owners to manage tables/staff and for customers to book online or walk in.

**Deployed on Vercel. Backend on Supabase.**

---

## Tech Stack
- **Framework**: Next.js 14 App Router (`app/` directory)
- **Database + Auth**: Supabase (PostgreSQL + RLS + Realtime)
- **State**: Zustand (cart: `persist` to localStorage; POS: in-memory with realtime)
- **Server state**: TanStack Query (POS data fetching, 60s refetch interval — Realtime handles live updates)
- **Payments**: Razorpay (create-order → checkout UI → webhook confirms)
- **Notifications**: Meta WhatsApp Cloud API (booking confirmations/reservations)
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
| `locations` | id, name, slug, address, phone, timezone, image_urls, is_active | Two locations, holds multiple image URLs |
| `users` | id, name, email, role, location_id | staff has location_id, owner has null |
| `tables` | id, location_id, name, type, hourly_rate, sort_order, is_active, people_pricing | type: snooker/pool/ps5/foosball |
| `orders` | id, location_id, type, customer_name, customer_phone, status, advance_paid, points_redeemed | type: walk_in/online, status: open/finalized/cancelled |
| `order_items` | id, order_id, table_id, status, actual_start, actual_end, expected_end, rate_per_hour, num_people | status: scheduled/running/finished/cancelled |
| `order_extras` | id, order_id, name, price, quantity, cost_price, inventory_item_id, is_deleted | Beverages/drinks added during session |
| `bookings` | id, order_id, order_item_id, scheduled_start, scheduled_end, status | Online reservation rows, checked in at POS |
| `payments` | id, order_id, amount, method, status, razorpay_order_id, razorpay_payment_id | method: cash/upi/card/razorpay |
| `coupons` | id, code, discount_type, discount_value, is_active, used_count | percent or flat discount |
| `table_availability_overrides` | id, table_id, date, is_closed | Block specific dates |
| `customer_profiles` | id, phone (unique), name, visit_count, total_spent, last_visit_at, points_balance | loyalty system |
| `membership_plans` | id, name, price, duration_days, discount_pct, free_hrs, is_active | Membership definitions |
| `customer_memberships` | id, customer_phone, plan_id, starts_at, expires_at, free_hrs_used, is_active | Active customer plans |
| `inventory_items` | id, location_id, name, category, selling_price, cost_price, image_url, is_active, stock_count, low_stock_threshold | Product catalog |
| `inventory_stock_logs` | id, inventory_item_id, location_id, change, reason, note, created_by | Stock audit trail |
| `app_settings` | id, data, updated_at, updated_by | Global app config (single row) |

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
- **Slot-based billing**: charge is always locked to the booked slot (`expected_end - actual_start`). Stopping early does not reduce the bill. No per-minute ticking, no OT blocks.
- For online check-ins, `actual_start = scheduled_start` and `expected_end = scheduled_end`, so the full booked slot is always billed regardless of when the customer arrives.
- For walk-ins, `actual_start = now` and `expected_end = actual_start + chosen_duration`.
- `GRACE_MINS` and `OT_BLOCK_MINS` are exported from the engine but no longer used in billing logic. The 2-minute auto-stop grace window is a local constant (`AUTO_STOP_GRACE_MINS = 2`) in `table-grid.tsx` and `context-panel.tsx`.

### Grace / Overtime Display
- **Overtime display** is active past `expected_end`: the session timer turns red and counts up ("-MM:SS over").
- No overtime charges — billing is purely slot-based (booked/chosen duration, not actual duration).
- **Manual Stop**: Staff must manually stop the session when finished. Auto-stop has been removed because silent auto-stopping was causing surprise behavior.

### Procedural Billing Rules
- **Online bookings**: once advance is paid and slot is confirmed, the full slot amount is owed. Late arrival does not reduce the bill.
- **No-show**: staff marks no-show from `PanelBooked`. Order is finalized immediately with `amount_due = 0` (advance already collected by Razorpay is the settlement). Slot is freed (order_item cancelled).
- **Walk-ins**: once an order is created and session started, the full chosen duration is owed. No cancel option in POS.

### Customer Lookup
- **POS walk-in**: debounced lookup after ≥6 digits typed — phone only, no name required, auto-fills name if field empty
- **Website checkout**: requires full Indian phone (10 digits, starts with 6/7/8/9) AND matching name before showing points balance; no name auto-fill

### WhatsApp Notifications
- **Status-based template selection**: Sends `nerfturf_booking_confirmation` / `gamehaus_booking_confirmation` (5 parameters + dynamic URL button) for fully paid bookings. Sends `nerfturf_table_reservation` / `gamehaus_table_reservation` (6 parameters) for reservations.
- **Dynamic Button Parameter**: The booking confirmation templates feature a dynamic "Cancel Booking" URL button which requires the `orderId` to be passed as a template parameter.
- **Net Cost Calculation**: Correctly factors in `discount_amount` alongside `advance_paid` to determine if a booking is fully paid.

### Local Timezones
- All date calculations (e.g. "today") use `getLocalDateString(timezone, date)` helper to extract local dates in `Asia/Kolkata` time to avoid shifting UTC dates causing incorrect date assignments on early morning bookings.

---

## Pages & Components

### Public
| Path | Component | Description |
|------|-----------|-------------|
| `/` | `components/public/splash-hero.tsx` | Landing page with splash animation + location cards |
| `/[locationSlug]` | `components/public/location-browse.tsx` | Table listing, 15-min slot multi-select booking |
| `/[locationSlug]/book` | `app/(public)/[locationSlug]/book/page.tsx` | Checkout — Razorpay payment |
| `/booking/[bookingId]` | `components/public/booking-confirmation.tsx` | Post-payment confirmation |

### POS (Staff) — 2-panel layout
| Component | Description |
|-----------|-------------|
| `components/pos/pos-screen.tsx` | Root POS layout — loads data, sets up realtime, builds `TableWithStatus` |
| `components/pos/table-grid.tsx` | Left panel — table cards with live status (idle/running/booked/bill-ready) |
| `components/pos/context-panel.tsx` | Right panel — context-aware: PanelDefault (upcoming), PanelWalkIn, PanelSession, PanelBooked |
| `components/pos/upcoming-drawer.tsx` | Upcoming bookings drawer list opened via header button |
| `components/pos/walk-in-slider.tsx` | Slide-in panel for new walk-in (legacy, may still be wired) |
| `components/pos/finalize-bill-modal.tsx` | Payment + bill finalization modal |
| `components/pos/extend-modal.tsx` | Extend running session dialog |

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
| POST | `/api/orders/[id]/finalize` | staff | Calculate bill, record payment, update profiles |
| POST | `/api/orders/[id]/extras` | staff | Add beverage/extra to order (updates stock count) |
| DELETE | `/api/orders/[id]/extras/[extraId]` | staff | Remove extra (reverts stock count) |
| POST | `/api/walkin` | staff | Combined walk-in order creation and session start |
| POST | `/api/sessions/start` | staff | Start a table session |
| POST | `/api/sessions/stop` | staff | Stop a running session |
| POST | `/api/sessions/extend` | staff | Extend expected end time |
| POST | `/api/sessions/people` | staff | Change player/controller count mid-session |
| POST | `/api/bookings/[id]/checkin` | staff | Check in — sets `actual_start = scheduled_start`, `expected_end = scheduled_end` (full slot billed) |
| POST | `/api/bookings/[id]/noshow` | staff | Mark no-show — cancels order_item (frees slot), finalizes order with `amount_due = 0` (advance already collected) |
| POST | `/api/payments/create-order` | public | Create Razorpay order |
| POST | `/api/payments/webhook` | Razorpay | Confirm payment, update advance_paid |
| GET/POST | `/api/locations` | owner | List/create locations |
| POST | `/api/locations/upload` | owner | Upload location images to table-images bucket |
| PATCH/DELETE | `/api/locations/[id]` | owner | Update/delete location |
| GET/POST | `/api/tables` | owner | List/create tables |
| PATCH/DELETE | `/api/tables/[id]` | owner | Update/delete table |
| POST | `/api/staff` | owner | Create staff account |
| GET/PATCH | `/api/settings` | owner | Get/update global app settings |
| POST | `/api/inventory/[id]/stock` | owner | Add/adjust stock for inventory item |
| GET | `/api/inventory/low-stock-count` | owner/staff | Get count of items below low-stock threshold |
| GET | `/api/inventory/low-stock-list` | owner | List items under low-stock threshold |

---

## Completed Features

### Landing Page (`/`)
- [x] Splash screen animation: loading → enter → hold → exit → gone phases
- [x] Timing: hold starts at 200ms, exit at 1400ms (1200ms hold), gone at 2100ms
- [x] Curtain lift uses expo-out easing (700ms, fast + smooth)
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
- [x] **Booked slots shown in grid** (not hidden) — muted red tint + strikethrough + "Booked" label, non-interactive
- [x] **Slot label flip**: before start selected → shows start time; after start selected → all other slots show their END time so clicking "8:45" means "session ends at 8:45"
- [x] **Slot loading skeleton**: `slotsLoading` state shows animated skeleton pills while API fetches blocked ranges — no flash of "all available"
- [x] Cart with slot range, duration, amount — persisted to localStorage
- [x] Cart isolated per location (switching locations clears cart)
- [x] **Mobile optimized**: slot grid `grid-cols-2 sm:grid-cols-3` (2 cols on phones), booking sheet padding tighter on mobile
- [x] **Booking confirmation skeleton** (`loading.tsx`) — Next.js App Router loading file shows immediately while server component fetches order data

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
- [x] **2-panel layout**: table grid (left, flex-1) + context panel (right, fixed 380px) — always visible, no overlays for core flows
- [x] Context panel adapts by table state: PanelDefault (upcoming bookings list), PanelWalkIn (idle table), PanelSession (running/bill-ready), PanelBooked (upcoming booking)
- [x] PanelBooked: Check In button (direct API call, no search drawer) + No-show / Close Bill button (2-step confirm, finalizes order with advance as settlement, frees slot)
- [x] PanelBooked: shows advance collected badge so staff can see what was paid online
- [x] **Slot-based procedural billing**: check-in sets `actual_start = scheduled_start` — customer billed for full booked slot regardless of arrival time
- [x] Walk-in: once session started, full chosen duration is owed — no cancel option
- [x] Upcoming booking pill shown on running table cards (amber, shows next customer name)
- [x] Extend modal: +30m, +60m, custom mins (respects 10-min buffer for upcoming bookings); closes instantly with optimistic countdown update
- [x] Finalize bill modal: bill breakdown, payment method (cash/upi only — card removed), collect
- [x] **Finalize bill uses `finalizeOrderId`** to look up order — NOT `selectedOrderId` (those are different store fields; using wrong one caused ₹0 bill bug)
- [x] **Walk-in without phone**: finalize modal shows phone input; staff can enter phone at billing time; phone saved to order + customer profile updated
- [x] **Loyalty points in context panel footer**: balance + redeem input shown directly in "Finalize & Collect" footer when bill is ready — no need to open modal first
- [x] Back-button protection (confirm before leaving POS) + tab/window close protection (`beforeunload`)
- [x] **Sign-out overlay**: full-screen `bg-black/70 backdrop-blur-sm` overlay with centered pulsing `LogOut` icon + "Signing out…" text; 700ms delay before auth fires so overlay is visible; button disabled during sign-out
- [x] **Full dark mode POS**: `dark` class forced on outer wrapper div — all child `dark:` variants apply automatically. Canvas `#0a0a0a`, side rail `#161616`, header/panels `#111`, borders `#1f1f1f`–`#222`
- [x] **POS side rail**: `#161616` bg, `#222` border, "Gamehaus" brand in orange `#D4541A`, sign-out white
- [x] **Walk-in allowed on tables with bookings >30 mins away**: `BOOKED_THRESHOLD_MINS = 30` in both `table-grid.tsx` and `context-panel.tsx`. Tables show as idle (with amber "Next [time]" pill) when booking is >30 mins away
- [x] **Optimistic UI on all POS actions**: stop session, start session, extend session, add extra, delete extra — UI updates on tap, reverts on API error

### Owner Panel (`/owner/*`)
- [x] Table CRUD (create, edit, toggle active, delete)
- [x] Location management
- [x] Staff creation (Supabase Auth user + users row)
- [x] Bookings view
- [x] Coupon management
- [x] Revenue reports
- [x] **Dark left sidebar nav** — replaced top nav; 240px fixed sidebar, orange active state, initials avatar, sign out at bottom with full-screen overlay (same as POS)
- [x] **Dashboard overview** — 4 stat cards (Today Revenue with ↑/↓ % vs yesterday, Live Tables, Bookings Today, Month Revenue); 7-day revenue bar chart (pure CSS, no library); Live Now panel (running tables with customer, elapsed, rate); Recent 8 orders table
- [x] **Per-location filtering on dashboard** — URL param `?loc={id}` filters all stats, live sessions, bookings, and recent orders to one location. Location tabs rendered as `<Link>` pills
- [x] **Per-location filtering on reports** — client-side `selectedLocationId` state; location tabs above the data; `filteredOrders` drives all derived stats (revenue by location, payment breakdown, top customers, summary cards)
- [x] **Revenue includes `advance_paid + amount_due`** — online Razorpay payments live in `advance_paid`; walk-in revenue in `amount_due`; both summed everywhere in dashboard and reports
- [x] **Business-day date bounds in reports** — fetches location opening/closing times; date range is `from+openingTime` → `to+closingTime` (may cross midnight), not calendar midnight
- [x] **Card removed** from payment methods — only cash/upi. Finalize schema and modal both updated
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
- [x] **Phone entry at finalize time**: if walk-in had no phone, modal shows phone input; lookup fires at ≥10 digits; `customer_phone` sent to finalize route which saves it to the order and updates `customer_profiles`
- [x] **Points shown in context panel footer**: `PanelSession` fetches customer points on mount, shows balance + redeem input directly in the bill footer; `clampedRedeem` updates `store.pointsToRedeem` and live total

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
- **Billing**: `calculateBill()` is pure, slot-based (charges `expected_end - actual_start`, not actual duration). Points discount applied after it returns, in the finalize route. Stopping early does not reduce the bill.
- **Check-in anchor**: `actual_start` is set to `booking.scheduled_start` (not arrival time) so late arrivals still pay the full booked slot.
- **No-show close**: noshow route finalizes the order with `amount_due = 0`; the Razorpay payment row already exists from the webhook. No new payment row needed — just close the order.
- **`pos-bookings` API**: returns `advance_paid` from the joined order so `PanelBooked` can display how much was collected online.
- **Optimistic updates pattern**: All fast mutations (toggle, stop, start, extend, add/delete extra) update Zustand store or TanStack Query cache immediately, then fire the API. On error, revert to previous state. On success, `invalidateQueries` for a fresh sync.
- **Owner panel optimistic pattern**: Uses TanStack Query `onMutate` → cancel in-flight queries → snapshot previous data → patch cache → return `{ prev }` for rollback in `onError`. `onSettled` always invalidates for a fresh sync.
- **formatElapsed** in `lib/utils.ts` — computes elapsed from `actual_start`.
- **Razorpay script**: Use `<Script strategy="lazyOnload">` from `next/script`, NOT a plain `<script>` tag — plain tags cause a preload warning because Next.js preloads the script but it isn't used within a few seconds on page load.
- **Mobile breakpoint**: Tailwind `sm:` = 640px. Phones are typically < 640px, tablets/desktops are ≥ 640px. Use `sm:` prefix to widen layouts at tablet and above.
- **POS dark mode**: the POS wrapper has `className="dark ..."` which forces dark mode for all children regardless of the site-wide theme. All `dark:` Tailwind classes inside the POS apply automatically.
- **`finalizeOrderId` vs `selectedOrderId`**: two separate Zustand fields. `selectedOrderId` = order selected on table grid. `finalizeOrderId` = order being finalized. Always use `openOrders.find(o => o.id === store.finalizeOrderId)` in the finalize modal — never `getSelectedOrder()`.
- **Finalize `customer_phone` override**: finalize route accepts optional `customer_phone` in body. If order has no phone and staff enters one at billing time, route updates the order and creates/updates `customer_profiles`.
- **Slot label flip (public booking)**: `displayTime = (hasStart && !isStartSlot) ? fmt(slotEndTime(s)) : fmt(s)` — once a start slot is selected, all other slots show their end time so the UX reads "click where you want to finish".
- **Slot loading skeleton**: `slotsLoading` state in `LocationBrowse`; set true by useEffect when `booking?.id` changes, cleared in `.finally()`. Shows animated skeleton grid so there's no flash of "all slots available" before blocked ranges load.
- **Booking confirmation loading**: `app/(public)/booking/[bookingId]/loading.tsx` shows a skeleton immediately while the server component's Supabase query runs — eliminates blank screen between redirect and data.
- **Parallel DB calls in API routes**: Independent Supabase writes use `Promise.all()`. In `orders/route.ts`: bookings insert + customer_profiles upsert run in parallel. In `finalize/route.ts`: coupon increment + customer profile fetch run in parallel (saves one round-trip before the profile update). In `checkin/route.ts`: booking status update + order_item start run in parallel.
- **POS refetch interval**: Set to 60000ms (60s) — Supabase Realtime pushes all live changes instantly; polling is only a safety net for missed events, so 60s is sufficient and avoids unnecessary network traffic.
- **Sign-out overlay**: `signingOut` state → renders `fixed inset-0 z-50` overlay immediately → `await new Promise(r => setTimeout(r, 700))` gives the overlay 700ms to be seen → then fires `supabase.auth.signOut()`. Pattern used in both `pos-screen.tsx` and `owner/nav.tsx`.

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
