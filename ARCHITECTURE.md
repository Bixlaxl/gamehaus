# Gamehaus — System Architecture & Technical Reference

This document serves as the authoritative technical reference for the Gamehaus project. It outlines the complete system design, database architecture, network data flows, state management, and external integrations.

---

## 1. High-Level Architecture Overview

Gamehaus uses a modern serverless model optimized for low latency and real-time synchronization.

```mermaid
graph TD
  Client[Browser Clients: Public / POS / Owner]
  Vercel[Vercel Edge Gateway & Routing]
  NextServer[Next.js Serverless API Routes]
  SupabaseDB[Supabase Postgres DB]
  SupabaseRealtime[Supabase Realtime Channel]
  SupabaseAuth[Supabase Auth Service]
  RazorpayAPI[Razorpay Gateway]
  WhatsAppAPI[Meta WhatsApp API]

  Client -->|HTTP Requests| Vercel
  Vercel --> NextServer
  NextServer -->|Reads & Writes / Bypasses RLS| SupabaseDB
  NextServer -->|Creates Razorpay Order| RazorpayAPI
  NextServer -->|Sends Invoice Notification| WhatsAppAPI
  SupabaseDB -->|Realtime DB Changes| SupabaseRealtime
  SupabaseRealtime -->|Websocket Push| Client
  Client -->|Auth Checks| SupabaseAuth
```

The system is split into three scopes:
1. **Public Portal:** Serves static landing details, location pages with table slots grids, cart state (persisted locally), and handles payments.
2. **Staff POS Screen:** Single-page dashboard showing real-time table cards. Communicates via REST APIs and receives instant state mutations via Supabase WebSockets.
3. **Owner Dashboard:** Administrator panels for configuration (locations, tables, staff, inventory) and analytics/reports.

---

## 2. System Data Flows

### A. Walk-in Order Creation
Walk-in sessions start immediately when a customer arrives at the café.

```mermaid
sequenceDiagram
  autonumber
  actor Staff
  participant POS as POS Screen (Zustand)
  participant API as /api/walkin
  participant DB as Supabase Database

  Staff->>POS: Enters name/phone, selects duration & starts session
  POS->>POS: Optimistically marks table card as "running"
  POS->>API: POST { customer_name, customer_phone, duration_mins, table_id }
  API->>DB: Check slot conflicts & active bookings
  alt Conflict Detected
    API-->>POS: Returns ERROR response
    POS->>POS: Reverts table card to "idle"
  else Slot Clear
    API->>DB: Create order (status: 'open') + order_items (status: 'running')
    DB-->>API: Success
    API-->>POS: Returns OK { order, order_items }
    POS->>POS: Updates local store and timers
  end
```

### B. Online Booking & Check-In
Prepaid online bookings are reserved in advance and checked in by staff when the customer arrives.

```mermaid
sequenceDiagram
  autonumber
  actor Customer
  participant Web as Online Slot Grid
  participant API as /api/orders
  participant Webhook as /api/payments/webhook
  actor Staff
  participant POS as Staff POS
  participant Checkin as /api/bookings/[id]/checkin

  Customer->>Web: Selects slots, clicks Book
  Web->>API: POST { name, phone, slots }
  API->>DB: Create order (status: 'open') + bookings (status: 'confirmed' / held)
  Web->>Web: Opens Razorpay Popup
  Customer->>Web: Completes payment
  Razorpay->>Webhook: Event: payment.captured
  Webhook->>DB: Update order.advance_paid = payment.amount
  Webhook->>DB: Update customer_profile.points_balance
  Webhook->>POS: Supabase Realtime alerts POS of new booking
  POS->>POS: Highlights table card as "booked" (upcoming status)
  Staff->>POS: Clicks "Check In"
  POS->>Checkin: POST /api/bookings/[id]/checkin
  alt Arrival is Early
    Checkin->>DB: Shift session: actual_start = now, expected_end = now + duration
  else Arrival is Late/On-Time
    Checkin->>DB: Anchor session: actual_start = scheduled_start, expected_end = scheduled_end
  end
  Checkin-->>POS: OK (starts running session)
```

### C. Finalization & Billing Flow
When a session concludes, the bill is calculated dynamically and finalized.

```mermaid
sequenceDiagram
  autonumber
  actor Staff
  participant POS as Finalize Modal
  participant API as /api/orders/[id]/finalize
  participant Engine as Billing Engine (calculateBill)
  participant DB as Supabase Database

  Staff->>POS: Clicks Finalize
  Note over POS: POS checks submittingRef.current<br/>to prevent double-click race conditions
  POS->>API: POST { points_redeemed, customer_phone_override }
  API->>DB: Fetch order details, items, extras, active membership, coupon, customer points
  API->>Engine: Run calculateBill(items, extras, coupon, advance_paid)
  Engine-->>API: Returns subtotal, discounts, netTotal
  API->>API: Apply Membership Discount (discount_pct)
  API->>API: Subtract Redeemed Points (1 point = ₹1)
  API->>API: Subtract advance_paid to calculate finalDue
  API->>DB: Perform Stage 1 parallel writes:
  Note over DB: 1. Update order status = 'finalized'<br/>2. Insert payment split rows (completed)<br/>3. Increment coupons.used_count (+1, if any)<br/>4. Update customer_memberships (free_hours_ledger & free_hrs_used)<br/>5. Update order_items status = 'finished'<br/>6. Update bookings status = 'finished'
  API->>DB: Perform Stage 2 sequential write:
  Note over DB: Fetch customer_profile & update (visit_count + 1, total_spent + paid, points_balance)
  API-->>POS: OK (closes bill)
  API->>WhatsApp: Trigger automated WhatsApp invoice notification
```

---

## 3. Database Layer

### Schema Blueprint

```mermaid
erDiagram
  locations ||--o{ tables : "has"
  locations ||--o{ users : "assigns staff"
  locations ||--o{ orders : "records"
  orders ||--|{ order_items : "contains"
  orders ||--o{ order_extras : "charges"
  orders ||--o{ payments : "audits"
  orders ||--o{ bookings : "references"
  tables ||--o{ order_items : "runs session"
  customer_profiles ||--o{ customer_memberships : "has plan"
  membership_plans ||--o{ customer_memberships : "defines"
  inventory_items ||--o{ order_extras : "stocks"
  inventory_items ||--o{ inventory_stock_logs : "audits"
```

---

## 4. Real-time Synchronization Architecture

Real-time POS synchronization is built on top of Supabase Realtime Channels. It guarantees that multi-browser POS terminals and client bookings stay completely in sync.

### Subscription Matrix

```
  Supabase WebSocket Stream
          │
          ├──> pos-{locationId} Channel (POS screen)
          │         │
          │         ├──> order_items (*) ──> Updates timer, status, active item
          │         ├──> orders (*)      ──> Recalculates live bill preview
          │         ├──> tables (*)      ──> Syncs table availability
          │         └──> order_extras(*) ──> Refreshes bill breakdown
          │
          └──> public-slots-{locationId} Channel (Public portal)
                    │
                    └──> order_items, bookings ──> Bumps slotsTick counter to force
                                                   blocked range refetch in grid
```

---

## 5. Billing Engine & Loyalty Calculations

The billing engine calculations follow this sequence to compute final checkout balances:

1. **Subtotal Calculation:**
   $$\text{Subtotal} = \sum (\text{Billed Sessions}) + \sum (\text{Beverages \& Extras})$$

2. **Coupon Deduction:**
   $$\text{SubtotalAfterCoupon} = \max(0, \text{Subtotal} - \text{CouponDiscount})$$

3. **Free Hours Ledger Deduction:**
   For members covering running sessions, decrement duration hours directly from table-type buckets in `customer_memberships.free_hours_ledger`.
   $$\text{SubtotalAfterFreeHrs} = \max(0, \text{SubtotalAfterCoupon} - \text{FreeHoursValue})$$

4. **Membership Percentage Deduction:**
   $$\text{SubtotalAfterMembership} = \max(0, \text{SubtotalAfterFreeHrs} \times (1 - \frac{\text{DiscountPct}}{100}))$$

5. **Loyalty Points Deduction:**
   $$\text{TotalDue} = \max(0, \text{SubtotalAfterMembership} - (\text{PointsRedeemed} \times \text{RedeemRate}))$$

6. **Final Checkout Balance:**
   $$\text{finalDue} = \max(0, \text{TotalDue} - \text{advance\_paid})$$
