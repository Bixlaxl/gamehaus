# Gamehaus — Operational Developer Manual (CLAUDE.md)

This document is the authoritative developer reference and operational manual for the Gamehaus project. It contains conventions, database definitions, API routes, workflow patterns, and strict constraints designed to keep modifications safe, localized, and consistent.

---

## 1. Project Overview & Tech Stack

Gamehaus is a booking and POS system for physical snooker/gaming café locations (Gamehaus, NerfTurf). It handles public online table bookings, real-time staff POS check-ins, walk-ins, multi-session tracking, inventory sales, membership benefits, and loyalty reward points.

* **Framework:** Next.js 14 App Router (`app/` directory). All routes run on **Edge Runtime** unless nodejs is explicitly required (e.g. for Razorpay cryptographic buffers).
* **Database & Auth:** Supabase (PostgreSQL + RLS + Realtime). Auth session synchronized between server and browser via `@supabase/ssr` cookies.
* **State Management:**
  * **Customer Cart:** Zustand persisted to `localStorage` under `"gamehaus-cart"`.
  * **POS UI:** Zustand in-memory store (`store/pos.ts`) synchronized via Supabase Realtime channel `"pos-{locationId}"`.
  * **Server State:** TanStack Query (`staleTime: 60000ms`, `refetchOnWindowFocus: false`).
* **Payments:** Razorpay Integration (API order creation -> client script checkout -> server webhook capture).
* **Notifications:** Meta WhatsApp Cloud API (automated booking confirmations, check-ins, invoices, and cancellations).
* **Styling:** Tailwind CSS + shadcn/ui. POS forces dark mode (`className="dark"` on POS wrapper).
* **Validation:** Zod schemas in `lib/validators/schemas.ts`.

---

## 2. Directory Responsibilities

* `app/(auth)/login/` - Staff/Owner authentication screen.
* `app/(owner)/owner/` - Owner panels (tables, staff, coupons, reports, memberships, settings).
* `app/(pos)/pos/` - POS table grid and session context panel.
* `app/(public)/` - Public landing splash page, location slot-grid browse, checkout, and confirmations.
* `app/api/` - Backend API endpoints (Edge or Node runtime).
* `components/pos/` - POS interface modules (`pos-screen`, `table-grid`, `context-panel`, overlays).
* `components/owner/` - Nav sidebar and owner dashboard modules.
* `components/public/` - Public landing page and booking slot grid.
* `lib/supabase/` - DB clients (`client.ts`, `server.ts`, `admin.ts`) and TypeScript types (`types.ts`).
* `lib/billing/` - Pure billing math engine (`engine.ts` and `engine.test.ts`).
* `lib/validators/` - Unified request schema validations.
* `store/` - Zustand client stores (POS and Cart).

---

## 3. Database Table Registry

| Table Name | PK / Unique Constraints | Key Columns | Purpose / Description |
| :--- | :--- | :--- | :--- |
| `locations` | `id` (uuid) | name, slug, address, phone, timezone, opening_time, closing_time, is_active, image_urls | Physical cafe locations |
| `users` | `id` (uuid -> auth.users) | name, email, role (`owner`\|`staff`), location_id, is_active, login_password | User accounts with app-defined credentials |
| `tables` | `id` (uuid) | location_id, name, type, hourly_rate, people_pricing (jsonb), modes (jsonb), sort_order, is_active | Gaming tables (snooker, pool, ps5, foosball, etc.) |
| `coupons` | `id` (uuid), `code` (unique) | location_id (null=global), code, discount_type (`percent`\|`flat`), discount_value, valid_from, valid_until, valid_from_time, valid_until_time, max_uses, used_count, is_active, is_public, valid_days (int[]) | Coupon/Promo code rules, timeslot, and Happy Hours |
| `orders` | `id` (uuid) | location_id, type (`online`\|`walk_in`), customer_name, customer_phone, status (`open`\|`finalized`\|`cancelled`), coupon_id, subtotal, discount_amount, public_discount_amount, total_amount, advance_paid, amount_due, points_redeemed, points_redeemed_online, membership_id | Primary transactional record for a guest visit |
| `order_items` | `id` (uuid) | order_id, table_id, status (`scheduled`\|`running`\|`finished`\|`cancelled`), scheduled_start, scheduled_end, actual_start, actual_end, expected_end, extended_mins, rate_per_hour, final_amount, num_people, is_deleted, free_hours_to_redeem, membership_id, selected_mode_name, is_table_released, checked_in_at | Individual table session components of an order |
| `order_extras` | `id` (uuid) | order_id, name, price, cost_price, quantity, inventory_item_id, is_deleted, added_by | Drinks, snacks, or accessories sold to a session |
| `bookings` | `id` (uuid) | order_id, order_item_id, scheduled_start, scheduled_end, held_until, status (`confirmed`\|`checked_in`\|`finished`\|`completed`\|`no_show`\|`cancelled`), no_show_marked_by | Online slot reservations blockages |
| `payments` | `id` (uuid) | order_id, amount, method (`cash`\|`upi`\|`card`\|`razorpay`), razorpay_order_id, razorpay_payment_id, status (`pending`\|`completed`\|`failed`\|`refunded`), collected_by | Audit trail of payments and manual/gateway refunds |
| `table_availability_overrides` | `id` (uuid) | table_id, date, start_time, end_time, is_blocked, reason | Explicit table slot blockages from Owner panel |
| `customer_profiles` | `id` (uuid), `phone` (unique) | phone, name, visit_count, total_spent, points_balance, last_visit_at | Loyalty profile tracks history and reward balance |
| `inventory_items` | `id` (uuid) | location_id, name, category, selling_price, cost_price, is_active, show_at_checkout, stock_count, low_stock_threshold | Catalogue of items for cafe purchase |
| `inventory_stock_logs` | `id` (uuid) | inventory_item_id, location_id, change, reason (`restock`\|`sale`\|`adjustment`\|`reverse`), order_extra_id, note | Ledger tracks items sold, restocked, or manually adjusted |
| `app_settings` | `id` (always 1) | data (jsonb), updated_at, updated_by | System variables (loyalty earn/redeem rates, policy tiers) |
| `membership_plans` | `id` (uuid) | name, price, duration_days, discount_pct, free_hrs, is_active, bound_table_ids (uuid[]) | Membership tier presets |
| `customer_memberships` | `id` (uuid) | customer_phone, plan_id, starts_at, expires_at, free_hrs_used, is_active, bound_table_ids (uuid[]), free_hours_ledger (jsonb), short_id | Active plan instances assigned to customer profiles |
| `tournament_registrations` | `id` (text) | name, phone, amount, status (`paid`\|`unpaid`), payment_id, razorpay_order_id, pass_id | Tournaments passes tracker |

---

## 4. Complete API Route Registry

### POS Operations & Management
* `GET /api/pos/tables` - Fetches tables with computed statuses, active running items, and upcoming slot bookings.
* `GET /api/pos/orders` - Lists active open orders at the caller's location.
* `GET /api/pos/bookings` - Fetches today's bookings for the POS upcoming list.
* `POST /api/pos/bookings/switch-table` - Swaps table session to another physical table of compatible type.
* `POST /api/pos/bookings/[id]/cancel` - Staff cancels manual or online booking, releases table slot, restores loyalty points.
* `POST /api/pos/manual-booking` - Creates manual reservation slot on the grid.
* `POST /api/pos/manual-bill` - Generates direct finalization for item sales with no table sessions.
* `DELETE /api/pos/bills/[id]` - Deletes finalized bills (Owner-only authentication, role verified at L27).
* `POST /api/pos/bills/[id]/send-whatsapp` - Manual re-send of WhatsApp invoice to customer.
* `POST /api/walkin` - Starts immediate walk-in session on POS grid.

### Booking Slot Operations
* `GET /api/tables/[id]/slots` - Fetches blocked time ranges for public slot picker; runs lazy cleanup on expired unpaid draft orders.
* `POST /api/bookings/[id]/checkin` - Checks in confirmed booking. Shifts early arrivals (<45m) or anchors to scheduled start/end for late arrivals.
* `POST /api/bookings/[id]/noshow` - Marks un-checked-in booking as no-show and cancels associated order item.
* `POST /api/bookings/[id]/reschedule` - Reschedules booking slot start/end times with overlap validation.

### Session Control
* `POST /api/sessions/start` - Starts scheduled session (`actual_start = now`, `status = 'running'`).
* `POST /api/sessions/stop` - Stops active session (`actual_end = now`, `status = 'finished'`, locks `final_amount`).
* `POST /api/sessions/extend` - Extends session expected duration (`expected_end` updated, logs `extended_mins`).
* `POST /api/sessions/remove-extension` - Reverts previous duration extension.
* `POST /api/sessions/people` - Updates player count mid-session and re-resolves hourly rate from `tables.people_pricing`.

### Customer, Loyalty & Memberships
* `POST /api/customers/lookup` - Checks points balance and active memberships via phone & fuzzy name match.
* `GET /api/customers/search` - Autocomplete matching names/phones on POS slider.
* `POST /api/memberships/assign` - Purchases/assigns membership plan to customer phone.

### Inventory & Stock
* `GET/POST /api/inventory` - Lists or registers catalog items.
* `PATCH/DELETE /api/inventory/[id]` - Updates catalog details or soft-deletes items.
* `POST /api/inventory/[id]/stock` - Restocks or adjusts inventory stock count (logs change).
* `POST /api/inventory/staff-consume` - Staff records item damage, spill, or personal consumption.
* `GET /api/inventory/stock-logs` - Fetches audit log for stock changes.
* `GET /api/inventory/checkout-addons` - Fetches catalog extras for public booking checkout overlay.
* `POST /api/orders/[id]/extras` - Adds beverage/food item to order and decrements catalog stock.
* `DELETE /api/orders/[id]/extras/[extraId]` - Soft-deletes extra (`is_deleted = true`) and reverses inventory stock.

### Master Administration (Locations, Tables, Coupons, Staff, Settings)
* `GET/POST /api/locations` & `PATCH/DELETE /api/locations/[id]` - Location branch management.
* `GET/POST /api/tables` & `PATCH/DELETE /api/tables/[id]` - Gaming table master management.
* `GET/POST /api/memberships` & `PATCH/DELETE /api/memberships/[id]` - Subscription plan master management.
* `GET/POST /api/coupons` & `PATCH/DELETE /api/coupons/[id]` - Promo code master management.
* `GET /api/coupons/active` & `GET /api/coupons/validate` - Active public coupon lookup and rules validator.
* `GET/POST /api/staff` & `PATCH/DELETE /api/staff/[id]` - Staff profile registration & management.
* `GET/PATCH /api/settings` - System policies (loyalty rates, cancellation tiers). Owner role enforced on PATCH (L49).

### Tablet Kiosk Companion
* `POST /api/tablet/login` - Authenticates tablet kiosk via staff credentials, returns JWT token & `location_id`.
* `GET /api/tablet/status` - Polls live session timer, computes residual owed bill, and returns `max_extend_mins` ceiling.

### Core Billing & Payments
* `POST /api/orders` - Creates online or walk-in orders with server-side table rate resolution.
* `POST /api/orders/[id]/confirm-online` - Confirms zero-due or fully-prepaid online bookings.
* `POST /api/orders/[id]/cancel` - Cancels order, evaluates cancellation policy tiers, triggers Razorpay refund API.
* `POST /api/orders/[id]/finalize` - Finalizes POS order, logs split payments, updates customer metrics, increments `coupons.used_count`.
* `POST /api/payments/create-order` - Registers Razorpay payment order for online booking checkout.
* `POST /api/payments/webhook` - Validates Razorpay HMAC signature, completes payments, promotes items to `scheduled`, inserts bookings, checks for cancelled order state before reviving.
* `GET /api/owner/reports` - Generates revenue, peak hour, staff performance, and membership analytics.

---

## 5. Architectural Constraints & Rules

1. **Service Role Client for API Writes:** Row Level Security (RLS) is active. Client browser SDK writes fail. API route updates/inserts MUST use `createAdminClient()`.
2. **Server-Side Finalize Idempotency:** `/api/orders/[id]/finalize` enforces `if (order.status !== 'open') return 400 INVALID_STATE` at L59, preventing duplicate payments or double coupon increments on retries.
3. **Single Source of Coupon Count Increments:** `coupons.used_count` is incremented EXCLUSIVELY inside `/api/orders/[id]/finalize` (L352). Neither `/confirm-online` nor `/payments/webhook` writes to `used_count`.
4. **Order Resurrection Guard in Webhook:** `/api/payments/webhook` checks `if (order?.status === 'cancelled')` at L106 to prevent delayed Razorpay webhooks from reviving explicitly cancelled orders or no-show bookings.
5. **Administrative Route Owner Role Gates:** Sensitive endpoints (`/api/settings`, `/api/owner/reports`, `/api/pos/bills/[id]`) enforce `if (viewer?.role !== 'owner') return 403 FORBIDDEN`. *(Note: Admin routes `/api/tables`, `/api/locations`, `/api/inventory`, `/api/memberships`, `/api/coupons` require owner role gate addition).*
6. **Check-In Anchoring Logic:** Early check-in (<45m) shifts `actual_start = now` and `expected_end = now + duration` if table is free. Late check-in anchors to `scheduled_start` and `scheduled_end` (customer billed for full slot).
7. **Lazy Booking Cleanup:** Unpaid draft guest bookings (>5m old) are cleaned up lazily during slot fetches (`GET /api/tables/[id]/slots`) and `POST /api/orders` via `cancelExpiredUnpaidOrders()`.
8. **Operating Shifts Boundary:** All report metrics, overview totals, and bill views group by store operating shift (e.g. 06:00 to 05:59 next morning or store `opening_time` to `closing_time`) rather than UTC midnight.

---

## 6. Common Pitfalls & Gotchas

* **TypeScript UUID Cast:** Querying membership short ID (e.g. `"FI2Q28"`) on uuid column errors. Validate UUID format (`/^[0-9a-f]{8}-.../i`) before querying `.eq('id', value)`.
* **Read-Modify-Write Stock Count:** `/api/orders/[id]/extras` and `/api/inventory/staff-consume` perform read-modify-write on `stock_count` in JS memory (`stock_count: current - qty`). Handle concurrent updates carefully.
* **Realtime Publication:** When adding new database tables, execute `ALTER PUBLICATION supabase_realtime ADD TABLE <table_name>;` to ensure WebSocket state sync works.
