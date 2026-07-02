# Gamehaus — Operational Developer Manual (CLAUDE.md)

This document is the authoritative developer reference and operational manual for the Gamehaus project. It contains conventions, abstractions, workflow patterns, and strict constraints designed to keep modifications safe, localized, and consistent.

---

## 1. Project Overview & Tech Stack

Gamehaus is a booking and POS system for physical snooker/gaming café locations (Gamehaus, NerfTurf). It handles public online table bookings, real-time staff POS check-ins, walk-ins, multi-session tracking, inventory item sales, and loyalty reward points.

* **Framework:** Next.js 14 App Router (`app/` directory). All routes run on **Edge Runtime** (`export const runtime = 'edge'`).
* **Database & Auth:** Supabase (PostgreSQL + RLS + Realtime). Auth session synchronized between server and browser via `@supabase/ssr` cookies.
* **State Management:**
  * **Customer Cart:** Zustand persisted to `localStorage` under `"gamehaus-cart"`.
  * **POS UI:** Zustand in-memory store (`store/pos.ts`) synchronized via Supabase Realtime channel `"pos-{locationId}"`.
  * **Server State:** TanStack Query (`staleTime: 60000ms`, `refetchOnWindowFocus: false`).
* **Payments:** Razorpay Integration (API order creation -> client script checkout -> server webhook capture).
* **Notifications:** Meta WhatsApp Cloud API (automated booking confirmations and reservations).
* **Styling:** Tailwind CSS + shadcn/ui. POS forces dark mode (`className="dark"` on POS wrapper).
* **Validation:** Zod schemas in `lib/validators/schemas.ts`.

---

## 2. Directory Responsibilities

* `app/(auth)/login/` - Staff/Owner authentication screen.
* `app/(owner)/owner/` - Owner panels (tables, staff, coupons, reports, memberships, settings).
* `app/(pos)/pos/` - POS table grid and session context panel.
* `app/(public)/` - Public landing splash page, location slot-grid browse, checkout, and confirmations.
* `app/api/` - Backend API endpoints (Edge runtime).
* `components/pos/` - POS interface modules (`pos-screen`, `table-grid`, `context-panel`, overlays).
* `components/owner/` - Nav sidebar and owner dashboard modules.
* `components/public/` - Public landing page and booking slot grid.
* `lib/supabase/` - DB clients (`client.ts`, `server.ts`, `admin.ts`) and TypeScript types (`types.ts`).
* `lib/billing/` - Pure billing math engine (`engine.ts` and `engine.test.ts`).
* `lib/validators/` - Unified request schema validations.
* `store/` - Zustand client stores (POS and Cart).

---

## 3. Database Table Registry

| Table Name | Primary Key / Indexing | Key Columns | Purpose |
| :--- | :--- | :--- | :--- |
| `locations` | `id` (uuid) | name, slug, address, phone, opening_time, closing_time, image_urls | Café location configurations |
| `users` | `id` (uuid -> auth) | name, email, role (`owner`\|`staff`), location_id | Staff & owner application accounts |
| `tables` | `id` (uuid) | location_id, name, type (`snooker`\|`pool`\|`ps5`\|`foosball`), hourly_rate, people_pricing (jsonb) | Playable tables/consoles |
| `orders` | `id` (uuid) | location_id, type (`online`\|`walk_in`), customer_name, customer_phone, status (`open`\|`finalized`\|`cancelled`), advance_paid, points_redeemed | Parent transaction for a visit |
| `order_items` | `id` (uuid) | order_id, table_id, status (`scheduled`\|`running`\|`finished`\|`cancelled`), expected_end, actual_start, rate_per_hour | Table sessions associated with an order |
| `order_extras` | `id` (uuid) | order_id, name, price, quantity, cost_price, inventory_item_id, is_deleted | Drinks/snacks sold to an active session |
| `bookings` | `id` (uuid) | order_id, order_item_id, scheduled_start, scheduled_end, status (`confirmed`\|`checked_in`\|`no_show`\|`cancelled`) | Scheduled online/manual reservations |
| `payments` | `id` (uuid) | order_id, amount, method (`cash`\|`upi`\|`razorpay`), status (`pending`\|`completed`\|`failed` | Payment records |
| `customer_profiles` | `phone` (unique) | name, visit_count, total_spent, points_balance, last_visit_at | Loyalty profiles (auto-created on checkout) |
| `membership_plans` | `id` (uuid) | name, price, duration_days, discount_pct, free_hrs, is_active | Membership definition table |
| `customer_memberships`| `id` (uuid) | customer_phone, plan_id, starts_at, expires_at, free_hrs_used, is_active | Active customer plans |
| `inventory_items` | `id` (uuid) | location_id, name, category, selling_price, cost_price, stock_count, low_stock_threshold | Store items catalog |
| `inventory_stock_logs`| `id` (uuid) | inventory_item_id, change, reason (`sale`\|`restock`\|`adjustment`) | Audit trail of inventory updates |
| `app_settings` | `id` (always 1) | data (jsonb config blob) | Global system configuration parameters |

---

## 4. Key Coding Conventions & Core Abstractions

### API Response Contract
All API routes must return responses in the unified format defined in `lib/validators/schemas.ts`:
* Success: `NextResponse.json(ok(data))`
* Error: `NextResponse.json(err(message, errorCode), { status })`

### Phone Validation Rules
Indian mobile numbers must be verified as exactly 10 digits starting with `6`, `7`, `8`, or `9`.
* Validation pattern: `/^[6-9]\d{9}$/`

### Billing Engine Logic (`lib/billing/engine.ts`)
* **Slot-Based Billing:** Charges are strictly calculated based on the booked window (`expected_end - actual_start`). Stopping early or checking in late does not reduce the bill. 
* **Extension:** Session extensions are added to `expected_end`.
* **Discounts Sequence:**
  1. Calculate `subtotal` = table sessions cost + beverages/extras cost.
  2. Apply `coupon` discount.
  3. Apply `membership` discount (`discount_pct`) to the remaining balance.
  4. Apply `points` discount based on dynamic settings (`settings.loyalty.redeem_rupees_per_point`, subtracted outside `calculateBill`).
  5. Subtract `advance_paid` to determine `finalDue`.
* **Loyalty Settings Constraint:** Loyalty parameters are dynamically loaded from settings (`earn_rupees_per_point`, `redeem_rupees_per_point`, `min_points_to_redeem`). Customers can only redeem points if their points balance is $\ge$ `min_points_to_redeem`. Enforced on the POS context panel, finalization bill modal, online checkout page, and backend finalization API.

---

## 5. Architectural Constraints (Rules Every Future Agent Must Follow)

> [!CRITICAL]
> **1. RLS Writes Bypass Constraint**
> Row Level Security (RLS) is enabled on all tables in Supabase. Browser-based client SDK writes will fail due to permission checks. All writes (inserts, updates, deletes) in API routes must be performed using the service role client (`createAdminClient()`).
>
> **2. Reports Page Security & RLS Bypass**
> Never fetch `locations` or `orders` directly using the client-side `supabase` client on the Reports page. Authenticated users without JWT claims will receive empty data. All Reports queries must execute server-side via the secure API endpoint `/api/owner/reports` using the admin client.
>
> **3. UUID Validation Constraint**
> Before querying the database with `customer_profiles.id`, verify if the variable is a valid UUID using a regex or validator. Short string IDs (e.g., membership short IDs like `"FI2Q28"`) must only be queried against the `short_id` column. Querying non-UUIDs on a UUID column causes database casting errors.
>
> **4. Safe Timestamps in Cancellations**
> When calculating refunds or releasing sessions, do not assume `actual_start` is set. If `actual_start` is null (e.g., manual booking not yet checked in), fall back to `created_at` or `now` to avoid `NaN` duration math.
>
> **5. Multi-Table Bookings Session State**
> For group walk-ins and multi-table bookings, finished tables must remain marked as occupied in the POS tables grid until the entire order is checked out. The POS store `computeTablesWithStatus` must check if other tables in the same active order are still `running`, preventing double-booking and premature clearing.

---

## 6. Common Pitfalls & Gotchas

* **POS Store Sampling:** Do not subscribe to the raw Zustand `now` clock in high-level POS components. Subscribe only in the Running Card, or use `Date.now()` inline to prevent tree-wide 1Hz rerendering.
* **Next.js Caching:** Edge API routes must declare `export const dynamic = "force-dynamic"` to bypass Vercel's URL caching.
* **Local Time:** Always extract dates using the `getLocalDateString("Asia/Kolkata", date)` helper instead of UTC strings. Early morning bookings can shift dates if UTC is used.
* **`finalizeOrderId` vs `selectedOrderId`:** In `finalize-bill-modal.tsx`, always look up the order using the store's `finalizeOrderId` rather than `selectedOrderId`. They are separate fields and misaligning them results in incorrect bill displays.
