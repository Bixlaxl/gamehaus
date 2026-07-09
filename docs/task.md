# Gamehaus — Project Blueprint, Architecture & Security Audit

This document serves as the master technical reference and onboarding guide for the Gamehaus project. It contains a complete overview of the application's design, database structure, business workflows, user permissions, external integrations, known technical debt, and prioritized security/logic audit findings.

---

# Project Overview

Gamehaus is a real-time gaming café and pool/snooker lounge management system. The application handles table slot bookings, walk-ins, staff POS session management, inventory sales, loyalty programs, and owner analytics for multiple café locations.

## Overall Architecture
Gamehaus is built as a Serverless Next.js Web Application integrated with Supabase (PostgreSQL, Realtime, Auth) and external APIs (Razorpay, WhatsApp Cloud API).

* **Serverless Backend (Next.js Edge & Node.js):** REST API endpoints under `/api` handle transaction processing, billing, session state mutations, webhooks, and reporting.
* **Supabase Realtime Stream:** Real-time updates (mutations on orders, order items, and bookings) are pushed directly to POS clients via WebSockets, eliminating polling.
* **Loyalty & Discount Engine:** A deterministic calculations layer handles flat hourly rates, tiered pricing (player/controller count), public coupons, membership plan discounts, and loyalty points.

## Technologies Used
* **Core:** Next.js 14 (App Router, Server Actions, Edge/Serverless runtimes), React 18, TypeScript, Tailwind CSS
* **Database & Auth:** Supabase PostgreSQL, Supabase Auth (Custom JWT Claims via Hook), Supabase Realtime replication
* **Payments:** Razorpay Node.js Gateway & Webhook Signature verification
* **Notifications:** Meta WhatsApp Business Cloud Graph API
* **State Management & Client Cache:** Zustand (POS screen state), TanStack React Query (server-state caching)
* **Testing:** Vitest

---

# Folder Structure

```
gamehaus-main/
├── app/                      # Next.js App Router root
│   ├── (auth)/               # Login layout and authentication page
│   ├── (owner)/              # Owner dashboard analytics, locations, tables, staff, inventory
│   ├── (pos)/                # Staff POS grid page
│   ├── (public)/             # Public client booking pages, cart, and digital receipt bill views
│   └── api/                  # Backend REST API routes (bookings, payments, sessions, etc.)
├── components/               # Reusable React UI components
│   ├── pos/                  # POS screen grids, sliders, modals, context sidebar
│   ├── public/               # Public booking slot grid and client components
│   ├── owner/                # Dashboard charts, layouts, filters
│   └── ui/                   # Reusable base elements (Dialog, Toast, Label, etc.)
├── lib/                      # Shared helper functions, validators, and backend utilities
│   ├── billing/              # Pure business logic pricing calculations (engine.ts)
│   ├── supabase/             # Client and admin client initializers
│   ├── validators/           # Zod schemas for input validation
│   └── whatsapp.ts           # WhatsApp template builder and API messenger
├── store/                    # Zustand client state (e.g., pos-store.ts)
├── supabase/                 # Database schema migrations
│   └── migrations/           # SQL migration files
├── gamehaus-app/             # Native mobile/tablet companion app codebase
├── docs/                     # Documentation folder (this file)
├── MIGRATIONS.sql            # Secondary SQL migration log for manual execution
├── package.json              # Project dependencies and script declarations
├── vercel.json               # Deployment configurations
└── tsconfig.json             # TypeScript rules
```

---

# Database

## Core PostgreSQL Schema

### `locations`
* **Purpose:** Represents distinct café branches.
* **Important Fields:** `slug` (unique handle used in public URLs), `timezone` (defaults to 'Asia/Kolkata'), `opening_time` / `closing_time` (defines business day bounds), `image_urls` (array of location photos), `is_active` (boolean toggle).
* **Relationships:** One-to-many with `tables`, `users`, and `orders`.

### `users`
* **Purpose:** Stores staff and owner profiles mapped to Supabase Auth accounts.
* **Important Fields:** `id` (references `auth.users.id`), `role` ('owner' or 'staff'), `location_id` (nullable for owner, mandatory for staff), `is_active` (boolean toggle), `login_password` (plain text copy of password for owner reference).
* **Constraints:** `staff_must_have_location` check constraint.

### `tables`
* **Purpose:** Master list of bookable assets (tables, consoles).
* **Important Fields:** `type` (e.g., 'snooker', 'pool', 'ps5', or custom types), `hourly_rate` (base cost), `people_pricing` (JSONB mapping of player count to rates: `{"4":380,"5":470}`), `modes` (JSONB array containing custom name, hourly_rate, and people_pricing tiers for tables with Snooker/Pool modes), `is_active` (boolean toggle).
* **Relationships:** Belongs to a location. One-to-many with `order_items`.

### `coupons`
* **Purpose:** Represents promotional discount codes.
* **Important Fields:** `code` (unique uppercase code), `discount_type` ('percent' or 'flat'), `discount_value` (amount/percent), `valid_from` / `valid_until` (validity limits), `max_uses` (null = infinite), `used_count` (int), `is_public` (boolean toggle, visible on public booking page).

### `orders`
* **Purpose:** Acts as a master transaction envelope.
* **Important Fields:** `type` ('online' or 'walk_in'), `status` ('open', 'finalized', or 'cancelled'), `advance_paid` (amount paid online), `subtotal`, `discount_amount`, `total_amount`, `amount_due` (remaining balance at POS), `points_redeemed` (loyalty points used), `membership_id` (linked membership used).
* **Relationships:** One-to-many with `order_items`, `order_extras`, and `payments`.

### `order_items`
* **Purpose:** Records a specific session segment on a table.
* **Important Fields:** `status` ('scheduled', 'running', 'finished', or 'cancelled'), `scheduled_start` / `scheduled_end` (for advance reservations), `actual_start` / `actual_end` / `expected_end` (for live POS execution), `extended_mins` (accumulated duration extensions), `rate_per_hour` (hourly rate locked for this session), `num_people` (player count), `selected_mode_name` (active mode name if applicable), `free_hours_to_redeem` (decimal hours covered by membership), `membership_id` (membership linked to this item), `is_deleted` (soft-delete flag).

### `order_extras`
* **Purpose:** Represents beverage, food, or retail add-on purchases.
* **Important Fields:** `inventory_item_id` (linked catalog item), `name` (item snapshot name), `price` (selling price), `cost_price` (wholesale cost snapshot), `quantity` (quantity sold), `is_deleted` (soft-delete flag).

### `bookings`
* **Purpose:** Bridges online orders to POS reservation check-ins.
* **Important Fields:** `status` ('confirmed', 'checked_in', 'no_show', or 'cancelled'), `held_until` (expiry deadline, usually `scheduled_start + 15 mins`), `no_show_marked_at` (timestamp when marked no-show).

### `payments`
* **Purpose:** Audits individual split payment transactions.
* **Important Fields:** `method` ('cash', 'upi', 'card', or 'razorpay'), `amount` (amount paid), `status` ('pending', 'completed', 'failed', or 'refunded'), `razorpay_order_id` / `razorpay_payment_id` (external transaction handles).

### `inventory_items`
* **Purpose:** Represents a location's menu or catalog item.
* **Important Fields:** `selling_price`, `cost_price` (used to track net profit), `stock_count` (source of truth on hand), `low_stock_threshold` (triggers low-stock alert).

### `inventory_stock_logs`
* **Purpose:** Tracks stock audits and changes.
* **Important Fields:** `change` (integer change, positive or negative), `reason` ('restock', 'sale', 'adjustment', 'reverse').

### `customer_profiles`
* **Purpose:** Tracks customer history and loyalty points.
* **Important Fields:** `phone` (unique key), `points_balance` (available loyalty points), `visit_count`, `total_spent`, `last_visit_at`.

### `membership_plans`
* **Purpose:** Master templates for subscription packages.
* **Important Fields:** `price`, `duration_days`, `discount_pct` (discounts on sessions and extras), `free_hrs` (allotted monthly hours), `bound_table_ids` (array of tables where plan is applicable).

### `customer_memberships`
* **Purpose:** Holds active subscriptions for a customer.
* **Important Fields:** `customer_phone`, `plan_id`, `starts_at` / `expires_at`, `free_hours_ledger` (JSONB track of remaining free hours per table type: `{"snooker": 10, "ps5": 5}`), `free_hrs_used` (decimal hours consumed), `short_id` (unique uppercase reference code for fast lookups).

---

# Features & Workflows

## 1. Booking Flow
The lifecycle of an online booking is as follows:
1. **Selection:** Customer goes to public URL `/[locationSlug]`, views the time grid, selects slots, and clicks **Book**.
2. **Order Placement (`POST /api/orders`):**
   * Verifies location is active.
   * Runs a collision check (verifies selected slots are not already booked or running).
   * Calculates subtotal, checks coupon validity, and applies membership discounts.
   * Inserts an order (status: `'open'`), inserts order items (status: `'scheduled'`).
3. **Payment Handshake:** 
   * The client initiates `POST /api/payments/create-order` to register a pending Razorpay transaction.
   * Customer pays via the Razorpay checkout overlay.
4. **Capture (`POST /api/payments/webhook`):**
   * Razorpay triggers the `payment.captured` event. The webhook verifies the signature.
   * The webhook completes the payment status, populates the order's `advance_paid` field.
   * Inserts confirmed rows into the `bookings` table.
   * Sends a confirmation message via WhatsApp.
5. **Check-In (`POST /api/bookings/[id]/checkin`):**
   * When the customer arrives, the staff clicks **Check In** on the POS.
   * If they check in early (up to 45 mins before), the session is shifted (`actual_start = now`). If late, the session is anchored (`actual_start = scheduled_start`).
   * The order item status transitions to `'running'`.
6. **Billing & Finalization (`POST /api/orders/[id]/finalize`):**
   * The staff stops the session (`status = finished`).
   * Taps **Finalize Bill**, chooses payment methods (Cash/UPI), redeems loyalty points or selects membership benefits.
   * The system updates the order (status: `'finalized'`), registers payments, applies point adjustments, and fires the WhatsApp digital invoice.

## 2. Resource Flow
* **Allocation:** Tables are assigned to slots based on `table_id` in `order_items` and `bookings`. 
* **Overlaps:** Blocked times are computed from active (running/scheduled) order items and confirmed bookings. The POS and Public grids block these slots from being selected.
* **Soft-Deletes:** When tables or locations are deleted, the system sets `is_active = false` (soft-delete) instead of running a SQL `DELETE`. This preserves foreign keys and historical receipts.

## 3. Pricing Flow
Prices originate from the `tables` master config in the database.
* **Flat Rate:** Looked up from `table.hourly_rate`.
* **Tiered pricing:** If `table.people_pricing` is defined, the system maps the player/controller count (`num_people`) to the matching key in the JSON object (e.g. `num_people = 5` matches `{"5": 470}`).
* **Mode pricing:** For tables supporting modes, the system scans `table.modes` JSON array for the selected mode name (`order_items.selected_mode_name`) and pulls its specific `hourly_rate` and `people_pricing`.
* **Read pathways:** Reads occur during POS clock ticking (`useMemo` in frontend UI) and inside `/api/sessions/people` or `/api/orders/[id]/finalize` in the backend.
* **Write pathways:** Initial prices are captured in `order_items.rate_per_hour` when an order is created, and updated if players are changed mid-session.

## 4. Billing Flow
Calculations are handled by the pure function `calculateBill` in `lib/billing/engine.ts`:
1. Calculates **Subtotal** (Sessions cost based on expected duration + quantity-weighted sum of non-deleted extras).
2. Subtracts **Coupon Discount** (percent or flat, capped at subtotal minus free hours).
3. Subtracts **Membership Free Hours** (reduces session time based on available hours in the `free_hours_ledger` for that table type).
4. Applies **Membership Plan Discount %** (applies to remaining session cost, overtimes, and extras).
5. Applies **Loyalty Points Discount** (1 point = ₹1, validated against settings and customer's balance).
6. Subtracts **Advance Paid** to yield `amount_due` (which must be paid at POS via Cash/UPI split).

## 5. Notification Flow
WhatsApp messages are sent using Meta Cloud APIs:
* **Booking Confirmation (`sendWhatsAppConfirmation`):** Sends `nerfturf_booking_confirmation`/`gamehaus_booking_confirmation` (if fully paid) or `nerfturf_table_reservation`/`gamehaus_table_reservation` (if advance paid with balance due).
* **Booking Cancellation (`sendWhatsAppCancellation`):** Sends cancellation templates with refund breakdown.
* **Billing Invoice (`sendWhatsAppInvoice`):** Sends digital bill URL `/[orderId]`. If the session utilized a membership, it sends a specialized member template showing remaining free hours or membership savings.
* **Click-to-Chat Fallback:** If the API fails, the backend returns a `wa.me` fallback link so staff can manually send the message via Web WhatsApp.

---

# User Roles & Permissions

### Customer
* **Rights:** Read-only access to locations, active deals, and table slots. Create online bookings, submit payments via Razorpay, and view digital invoices (`/bill/[orderId]`).
* **RLS/Access:** Anonymous web client. Bypasses RLS on SELECT for public settings/locations/deals.

### Staff
* **Rights:** Manage POS dashboard, start/stop/extend sessions, update player counts, sell inventory extras, check in bookings, and finalize payments.
* **Access Restrictions:** Blocked from accessing `/owner` dashboard pages. Restricted in POS writes to their assigned `location_id`.
* **Security Bypass:** REST API endpoints bypass RLS using the Supabase Service Role (admin client). They check `session` validation inline in the routes.

### Owner / Admin
* **Rights:** Full access to all branches. Can CRUD locations, tables, staff, inventory items, and coupons. Edit global settings, view system-wide revenue, profit reports, and history.
* **Access Restrictions:** Bypasses location scoping. Requires the `owner` role verification.

---

# APIs & Endpoints

### Bookings & Sessions
* `POST /api/bookings/[id]/checkin` – Check-in scheduled booking.
* `POST /api/bookings/[id]/noshow` – Mark booking as no-show.
* `POST /api/bookings/[id]/reschedule` – Reschedule slots.
* `POST /api/sessions/start` – Start scheduled walk-in session.
* `POST /api/sessions/stop` – Stop running session, calculate final cost.
* `POST /api/sessions/extend` – Extend active session duration.
* `POST /api/sessions/people` – Update player/controller count, re-resolve hourly rate.

### Orders & Checkout
* `GET /api/orders` – Fetch bookings/orders.
* `POST /api/orders` – Create new online or walk-in order.
* `POST /api/orders/[id]/finalize` – Finalize payment splits, apply loyalty, deduct membership hours, and close order.
* `POST /api/orders/[id]/cancel` – Cancel order.
* `POST /api/orders/[id]/extras` – Add beverage/food items to order (updates inventory stock).
* `DELETE /api/orders/[id]/extras/[extraId]` – Delete beverage/food item.

### Inventory Catalog
* `GET /api/inventory` – Fetch inventory items.
* `POST /api/inventory` – Create catalog item.
* `PATCH /api/inventory/[id]` – Update item details.
* `DELETE /api/inventory/[id]` – Deactivate or permanently delete item.
* `POST /api/inventory/[id]/stock` – Adjust item stock counts, logs changes.
* `GET /api/inventory/[id]/stock` – Fetch stock logs.

### Locations & Tables
* `GET /api/locations` – Fetch locations.
* `POST /api/locations` – Create location.
* `PATCH /api/locations/[id]` – Update location.
* `DELETE /api/locations/[id]` – Soft-delete location.
* `GET /api/tables` – Fetch all tables.
* `POST /api/tables` – Create table.
* `PATCH /api/tables/[id]` – Update table details.
* `DELETE /api/tables/[id]` – Soft-delete table.
* `GET /api/tables/[id]/slots` – Get blocked time ranges.

### Memberships & Settings
* `GET /api/memberships` – List membership plans.
* `POST /api/memberships` – Create membership plan.
* `PATCH /api/memberships/[id]` – Update plan.
* `DELETE /api/memberships/[id]` – Delete plan.
* `POST /api/memberships/assign` – Purchase/assign membership.
* `GET /api/settings` – Fetch app settings.
* `PATCH /api/settings` – Update settings (loyalty rates, cancellation rules).

### Payments & Analytics
* `POST /api/payments/create-order` – Create Razorpay payment transaction.
* `POST /api/payments/webhook` – Capture Razorpay event, update database.
* `GET /api/owner/reports` – Generate revenue, peak hour, and membership report data.

---

# Known Technical Debt & Code Smells

1. **Broken JWT Claims Hook Check (`003_auth_hook.sql`):**
   * Line 25 in the SQL migration checks `if user_data.id is not null`. However, the SELECT query only fetches `role`, `location_id`, and `is_active` (`select role, location_id, is_active into user_data ...`).
   * Because `id` is not selected, `user_data.id` is null, meaning the claims hook fails to inject `role` or `location_id` into the JWT token!
   * *Impact:* RLS policies using `auth.jwt()` custom attributes will fail because the hook skips adding them.
   * *Resolution recommendation:* Add `id` to the select list in the auth hook.

2. **Lazy Booking Cleanup:**
   * Expired guest orders are cleaned up inline on GET slot requests (`app/api/tables/[id]/slots/route.ts`) and POST order requests.
   * *Impact:* Creates unnecessary latency for clients during checkout or page browsing, and cleanup is entirely dependent on client traffic.

3. **No Database Transactions on Edge APIs:**
   * API endpoints (like finalization or stock updates) execute multiple distinct Supabase queries. If one query fails mid-process, the database is left in a partially mutated/inconsistent state.

---

# Priority-Based Audit Findings

## Critical Issues

### 1. Online Booking Price-Tampering Vulnerability [COMPLETED - 2026-07-08]
* **Description:** In `POST /api/orders` (`app/api/orders/route.ts`), the system reads the table's `rate_per_hour` directly from the client's request payload without verifying it against the database.
* **Root Cause:** The endpoint mapped `items` to `rate_per_hour: item.rate_per_hour` and calculated `totalCost` using this user-supplied rate, bypassing database rates.
* **Files Involved:** `app/api/orders/route.ts`
* **Implementation Summary:** 
  * Queried database configurations (`hourly_rate`, `people_pricing`, `modes`, `type`, `name`) for all requested tables.
  * Dynamically resolved the correct server-calculated rate per hour on each item, respecting base rate, selected mode, and tiered people pricing.
  * Bypassed the client-provided payload rate entirely, mapping resolved values downstream for subtotals, coupon/membership discounts, advance payments, and item inserts.
* **Verification Performed:**
  * Ran local Next.js instance and posted a tampered payload with `rate_per_hour: 1` instead of `250`.
  * Verified the order succeeded, but the database stored the corrected rate of `250`, completely ignoring the client-supplied rate.
  * Verified unit tests still pass successfully.
* **Remaining Risks:** None. Server is now the single source of truth for pricing calculations during booking creation.

---

## High Priority Issues

### 1. Broken Permission Scopes on Administrative REST Routes
* **Description:** Endpoints that configure tables, locations, and membership plans bypass RLS via the admin client but do not verify that the authenticated user is an owner.
* **Root Cause:** `POST/PATCH/DELETE` in `/api/tables`, `/api/locations`, and `/api/memberships` only check `if (!session)`. They lack a check against the user's role.
* **Files Involved:**
  * `app/api/tables/route.ts`
  * `app/api/tables/[id]/route.ts`
  * `app/api/locations/route.ts`
  * `app/api/locations/[id]/route.ts`
  * `app/api/memberships/route.ts`
  * `app/api/memberships/[id]/route.ts`
  * `app/api/inventory/route.ts`
  * `app/api/inventory/[id]/route.ts`
* **Risk:** A staff member (or anyone with a valid login session) can send direct HTTP PATCH/POST/DELETE requests to delete locations, modify table prices, edit inventory prices, or create free membership plans.
* **Proposed Solution:** Query the viewer's profile inside these endpoints and block requests with a `403 Forbidden` if their role is not `'owner'`, similar to the pattern in `app/api/settings/route.ts`.

### 2. Missing `id` in custom access token hook SELECT statement
* **Description:** The custom JWT claims hook check is broken because `id` is not selected from `public.users`.
* **Root Cause:** `select role, location_id, is_active into user_data` is run, but `if user_data.id is not null` is checked.
* **Files Involved:** `supabase/migrations/003_auth_hook.sql`
* **Risk:** RLS policies utilizing `auth.jwt()` custom attributes will fail because the hook skips adding them.
* **Proposed Solution:** Modify the SELECT statement to fetch `id` (or verify using `user_data.role` instead of `user_data.id`).

---

## Medium Priority Issues

### 1. Potential Stock Count Adjustment Race Condition
* **Description:** Adjusting stock counts reads the current count, calculates the change, and writes the new count without a database transaction.
* **Root Cause:** Two simultaneous updates could read the same count and perform updates, causing one adjustment to overwrite the other.
* **Files Involved:** `app/api/inventory/[id]/stock/route.ts`
* **Risk:** Inaccurate inventory counts if multiple staff update stock simultaneously.
* **Proposed Solution:** Perform the update using a relative SQL update (e.g. `UPDATE inventory_items SET stock_count = stock_count + :change`) or run via a database RPC.

---

## Low Priority Issues

### 1. Lazy Booking Cleanup Latency
* **Description:** `cancelExpiredUnpaidOrders` runs inline during client slot fetches and order placement.
* **Root Cause:** No background cron daemon.
* **Files Involved:**
  * `app/api/tables/[id]/slots/route.ts`
  * `app/api/orders/route.ts`
* **Risk:** Delays client request response times.
* **Proposed Solution:** Move cleanup task to a dedicated background serverless cron job (e.g., Vercel Cron) scheduled to execute every minute.

---

## Pricing Investigation

This section documents every possible code path that can read, write, or affect table pricing, rate per hour, and bill calculations, outlining potential race conditions, concurrent request issues, and reproducing unexpected price change scenarios.

### 1. Pricing Write Map

| Write Path Location (File / Function) | API Endpoint / Page / Trigger | Database Table & Columns Modified | Affected Records | Trigger Condition | Overwrite Risk & Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`app/api/tables/[id]/route.ts`** (PATCH) | `PATCH /api/tables/[id]` (Owner panel save) | `tables.hourly_rate`, `tables.people_pricing`, `tables.modes` | Single row | Admin saves table details via Settings UI | **High:** Lack of role check allows any authenticated session (including staff) to edit master prices. In addition, editing minor details (like sort order) resubmits the full pricing payload which could overwrite unedited fields with stale UI form defaults. |
| **`app/api/tables/route.ts`** (POST) | `POST /api/tables` (Owner panel create) | `tables.hourly_rate`, `tables.people_pricing`, `tables.modes` | Single row | Admin creates a new table | **Medium:** Allows any logged-in session to create tables with arbitrary pricing due to missing role gate. |
| **`app/api/orders/route.ts`** (POST) | `POST /api/orders` (Public client booking checkout) | `order_items.rate_per_hour` | Multiple rows | Customer checks out online or POS creates order | **High:** Bypasses DB checks and accepts `rate_per_hour` directly from the client request. Overwrites any database-configured rates with whatever is sent in the HTTP payload. |
| **`app/api/sessions/people/route.ts`** (POST) | `POST /api/sessions/people` (POS sidebar player change) | `order_items.num_people`, `order_items.rate_per_hour` | Single row | Staff clicks player count picker on active session | **High:** Overwrites the active session's snapshotted base rate with the latest table rates from the database dynamically, which can override custom start rates or historical promo rates. |
| **`app/api/sessions/stop/route.ts`** (POST) | `POST /api/sessions/stop` (POS Stop Table button) | `order_items.status`, `order_items.actual_end`, `order_items.final_amount` | Single row | Staff stops a running table session | **Low:** Computes final session cost dynamically and locks it in `final_amount`. Safe if inputs are correct. |
| **`app/api/walkin/route.ts`** (POST) | `POST /api/walkin` (POS start walkin) | `order_items` (multiple columns) | Multiple rows | Staff starts standard walkin session | **Low:** Snapshots and locks the table's current database rate inside the session record at startup. |
| **`app/api/pos/manual-bill/route.ts`** (POST) | `POST /api/pos/manual-bill` (POS manual checkout) | `order_items` (multiple columns) | Multiple rows | Staff creates manual invoice | **Low:** Snapshots the provided rate into the session. |
| **`app/api/bookings/[id]/checkin/route.ts`** (POST) | `POST /api/bookings/[id]/checkin` (POS Checkin) | `order_items.status`, `order_items.actual_start`, `order_items.expected_end` | Single row | Staff checks in upcoming slot | **Low:** Activates the pre-scheduled order item. |
| **`app/api/sessions/extend/route.ts`** (POST) | `POST /api/sessions/extend` (POS Extend session) | `order_items.expected_end`, `order_items.extended_mins` | Single row | Staff adds extra time to session | **Low:** Mutates expected end time. |

### 2. Dependency & Concurrent Request Analysis

* **Who / What Calls the Write paths:**
  * Master updates (`/api/tables`) are called strictly by the React Query mutations inside `app/(owner)/owner/tables/content.tsx` when admins submit the form.
  * Active session updates (`/api/sessions/*`) are called by the staff POS screen (`components/pos/context-panel.tsx` and `components/pos/table-grid.tsx`) when clicking controls.
  * Public checkout (`/api/orders`) is called by the customer checkout flow (`app/(public)/[locationSlug]/book/page.tsx`).
* **Stale State & Overwrite Risks:**
  * **Admin settings form overwrite:** The admin form loads table details on edit. If the schema has multiple nested fields (like `modes` and `people_pricing`), saving the form updates the *entire* table row. If another admin updated table rates in the meantime, the second admin's save will overwrite them with stale values.
  * **Concurrences:** There are no database transactions wrapping active session updates. If two staff members open the same table sidebar at the same time and adjust players, the subsequent update will overwrite the first.

### 3. Verification of Intended Business Logic

1. **Source of Truth:**
   * **Master Config:** The `tables` table (specifically `hourly_rate`, `people_pricing`, `modes` columns) is the sole source of truth for pricing.
   * **Session Lock:** At creation time, the session snapshots the rate in `order_items.rate_per_hour`. 
2. **Historical Bookings:**
   * Finished/Finalized sessions must **never** be affected by changes to table master rates or player counts. They are locked transaction logs.
3. **Staff Capabilities:**
   * Staff can modify active session player counts (which recalculates session-specific rates), but are restricted from editing master table pricing.
4. **Client Requests:**
   * Client HTTP payloads must **never** be trusted for booking prices. The backend must independently query and apply table rates.

### 4. Unexpected Price Change Scenarios (Reproduction Steps)

#### Scenario A: Online Booking Price-Tampering (Client-Controlled)
* **Root Cause:** `/api/orders` trusts the request payload's `rate_per_hour` and uses it to calculate the advance payment and final bill.
* **Reproduction Steps:**
  1. Intercept a public checkout POST request to `/api/orders`.
  2. Change `items[0].rate_per_hour` from `380` to `1` in the payload.
  3. Submit the request.
  4. The server creates an order with a subtotal based on ₹1/hour.
  5. The customer pays ₹1 via Razorpay and the booking is confirmed at this tampered rate.
* **Likelihood:** High
* **Risk:** Extreme financial loss.

#### Scenario B: Player Count Adjustment Overwrites Custom Rates
* **Root Cause:** `/api/sessions/people` and `PeoplePicker` fetch the latest table price from the database to recalculate rates, overriding any custom start rate or historically locked rate.
* **Reproduction Steps:**
  1. A session is started with a custom rate of ₹300 (or table rate was ₹300 when booked).
  2. Owner changes the table's master rate to ₹350 in Settings.
  3. Staff updates the player count mid-session on the POS.
  4. The session's `rate_per_hour` is automatically recalculated to ₹350, overriding the initial ₹300 rate.
* **Likelihood:** High
* **Risk:** Inconsistent bills and customer complaints.

#### Scenario C: Form Submit Default Reset (High Risk of Price Overwrites)
* **Root Cause:** Both the Table and Inventory edit forms send the *entire* entity object payload (including pricing and mode structures) on every save. If the form state contains stale values (e.g., loaded from a local device's localStorage cache or outdated state), saving the form will overwrite the database with those stale prices.
* **Reproduction Steps:**
  1. Owner A updates the price of a standard table to ₹350 on Device A.
  2. Owner B opens `/owner/tables` on Device B. Because the `"tables"` query is persisted in localStorage, Device B loads the stale price of ₹300.
  3. Owner B edits the table's sort order or description on Device B. The form pre-populates with the stale ₹300 rate.
  4. Owner B saves the form. The client PATCHes `/api/tables/[id]` with the full payload containing `hourly_rate: 300`.
  5. The database hourly rate is overwritten back to ₹300.
* **Likelihood:** High
* **Risk:** Master configuration price corruption.

### 5. Investigation of Table & Inventory Master Price Corruption

This section answers the specific questions regarding unexpected table and inventory price changes during active POS usage.

#### Answers to Key Questions

1. **Is there any code running in the POS that updates Tables?**
   * **Answer:** **No.** There are absolutely no database updates or insertions targeting the `tables` table configuration anywhere in the POS pages, POS components, or POS API endpoints. The POS only performs SELECT queries to read table configurations.
2. **Is there any code running in the POS that updates Inventory?**
   * **Answer:** **Yes, but only stock counts.** The POS updates the `inventory_items` table database columns exclusively to decrement `stock_count` when extras are sold (e.g., inside `POST /api/orders/[id]/extras` and `POST /api/pos/manual-bill`) or increment `stock_count` on item deletion/reversals. It **never** writes to or modifies catalog prices (`selling_price` or `cost_price`).
3. **Are any generic update utilities shared by both?**
   * **Answer:** **Yes, the RLS bypass client.** Both edit flows call their respective PATCH endpoints (`/api/tables/[id]` and `/api/inventory/[id]`) which leverage the admin client (`createAdminClient()`) to bypass RLS. Additionally, both client-side forms construct and transmit the *entire* object configuration during saving rather than only the modified fields.
4. **Is there any scheduled or automatic synchronization?**
   * **Answer:** **No.** There are no background sync tasks, cron jobs, or database trigger loops that modify `tables` or `inventory_items` configurations.
5. **Is there any UPDATE or UPSERT that sends an entire object instead of only modified fields?**
   * **Answer:** **Yes.** Both `owner/tables/content.tsx` (PATCH `/api/tables/[id]`) and `owner/inventory/content.tsx` (PATCH `/api/inventory/[id]`) compile and send the full object payload (containing pricing fields) on every edit save, overwriting the entire row instead of executing granular field updates.
6. **Is there any code that writes stale React state back to the database?**
   * **Answer:** **Yes (Critical Path).** In `components/providers.tsx`, the TanStack React Query cache persists the `"tables"` query to the browser's `localStorage` via the `sync-storage-persister`. If an owner opens the tables page on a device, the page loads the stale table configuration from local storage. When they click edit and save, the form state (carrying the old prices) is submitted, overwriting the database.
7. **Are there any UPDATE statements without a sufficiently restrictive WHERE clause?**
   * **Answer:** **No.** All PATCH and DELETE handlers are properly scoped using `.eq("id", id)`. However, the lack of role checks on these admin routes allows any authenticated session (including staff POS accounts) to call them.
8. **Could concurrent requests overwrite newer values?**
   * **Answer:** **Yes.** Since updates are not wrapped in database transactions, locks, or optimistic concurrency tags, concurrent submissions will overwrite each other.

#### Staff POS Activity Write Timeline

When a staff member simply uses the POS, the following timeline of write operations occurs:
* **Active table starts / Check-in:** inserts `orders` (status `open`), inserts/updates `order_items` (status `running`), updates `bookings` (status `checked_in`).
* **Extras sold:** updates `inventory_items.stock_count` (decrements count), inserts `inventory_stock_logs`, inserts `order_extras`.
* **Session stops:** updates `order_items` (status `finished`, sets `final_amount` and `actual_end`).
* **Finalize bill:** updates `orders` (status `finalized`, sets total billing snapshots), inserts `payments` split records, updates `customer_memberships` (deducts hours), updates `customer_profiles` (adds spend/points).

**Critical Conclusion:** None of the normal POS workflows touch master tables or inventory prices. The pricing corruption is strictly caused when:
1. The React Query cache persists `"tables"` to `localStorage` (stale state loading).
2. The owner dashboard PATCH requests submit the *entire* object configuration during edits (stale state overwriting).
3. The lack of role gates on `/api/tables` and `/api/inventory` allow any page or session to invoke writes.

---

## Post-Audit Maintenance Logs

### Phase 1: React Query Persistence Exclusions
* **What changed:** Excluded dynamic configuration query keys (`"tables"`, `"manual-booking-tables"`, `"locations"`, `"coupons"`, and `"membership-plans"`) from the React Query local storage persister inside `shouldDehydrateQuery`.
* **Why it changed:** Storing these dynamic configuration lists in `localStorage` caused local devices to load stale cached data (such as old table hourly rates) on page visit, which then pre-populated edit forms and accidentally overwrote updated rates in the database.
* **Files modified:** [components/providers.tsx](file:///Users/ahmedbilal/Desktop/gamehaus-main/components/providers.tsx)
* **Verification performed:**
  - Verified local compilation by executing a Next.js production build (`npm run build`).
  - Verified that all unit tests pass successfully (`npx vitest run`).
* **Remaining risks:** Stale pricing data can still be pre-populated if a user has a page loaded in their browser tab for over 60 seconds without refreshing (in-memory React Query cache `staleTime`), which will be resolved by client-side dirty-checking (Phase 2) and PATCH whitelist verification (Phase 3).

### Phase 2: Client-Side Dirty-Checking in Owner Edit Forms
* **What changed:** Implemented dirty-checking on edit form submissions in all 6 Owner Dashboard edit views (Tables, Inventory, Locations, Coupons, Staff, and Memberships). Payload objects now only compile and transmit fields that differ from the initial database values loaded at form initialization. If no fields have changed, the submission request is bypassed entirely.
* **Why it changed:** Previously, editing any unrelated field (like sort order) would re-submit the entire object including cached stale prices, reverting updated database values.
* **Files modified:**
  - [app/(owner)/owner/tables/content.tsx](file:///Users/ahmedbilal/Desktop/gamehaus-main/app/(owner)/owner/tables/content.tsx)
  - [app/(owner)/owner/inventory/content.tsx](file:///Users/ahmedbilal/Desktop/gamehaus-main/app/(owner)/owner/inventory/content.tsx)
  - [app/(owner)/owner/locations/content.tsx](file:///Users/ahmedbilal/Desktop/gamehaus-main/app/(owner)/owner/locations/content.tsx)
  - [app/(owner)/owner/coupons/content.tsx](file:///Users/ahmedbilal/Desktop/gamehaus-main/app/(owner)/owner/coupons/content.tsx)
  - [app/(owner)/owner/staff/content.tsx](file:///Users/ahmedbilal/Desktop/gamehaus-main/app/(owner)/owner/staff/content.tsx)
  - [app/(owner)/owner/memberships/content.tsx](file:///Users/ahmedbilal/Desktop/gamehaus-main/app/(owner)/owner/memberships/content.tsx)
* **Verification performed:**
  - Verified local compilation by executing a Next.js production build (`npm run build`).
  - Verified that all unit tests pass successfully (`npx vitest run`).
* **Remaining risks:** Lack of whitelist validation on the backend endpoints could still allow a crafted or compromised client request to perform unintended wholesale writes. This will be secured in Phase 3.

### Phase 3: Backend PATCH Endpoint Safety Whitelisting
* **What changed:** Enforced backend validation schemas (`updateTableSchema`, `updateInventoryItemSchema`, and newly introduced `updateLocationSchema`) as the single source of truth for the PATCH endpoints to strip and ignore any unexpected or read-only fields. Added programmatic ignored fields logging when `process.env.NODE_ENV === "development"`.
* **Why it changed:** Prevents malicious or stale requests from writing unauthorized/stale parameters (such as `stock_count` or custom fields) to the database.
* **Files modified:**
  - [lib/validators/schemas.ts](file:///Users/ahmedbilal/Desktop/gamehaus-main/lib/validators/schemas.ts)
  - [app/api/locations/[id]/route.ts](file:///Users/ahmedbilal/Desktop/gamehaus-main/app/api/locations/[id]/route.ts)
  - [app/api/tables/[id]/route.ts](file:///Users/ahmedbilal/Desktop/gamehaus-main/app/api/tables/[id]/route.ts)
  - [app/api/inventory/[id]/route.ts](file:///Users/ahmedbilal/Desktop/gamehaus-main/app/api/inventory/[id]/route.ts)
* **Verification performed:**
  - Verified local compilation by executing a Next.js production build (`npm run build`).
  - Verified that all unit tests pass successfully (`npx vitest run`).
* **Remaining risks:** None identified. The three-phase caching and overwrites mitigation strategy is now fully implemented and verified.
