import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

import { sendWhatsAppConfirmation } from "@/lib/whatsapp";

export const runtime = "edge";


/**
 * Manual phone-call booking. Same data shape as an online checkout, but the
 * customer's payment (if any) was taken in person — we record it directly
 * rather than waiting on a Razorpay webhook.
 *
 *   POST /api/pos/manual-booking
 *
 *   {
 *     location_id, customer_name, customer_phone,
 *     table_id, scheduled_start, scheduled_end,
 *     rate_per_hour, num_people?, selected_mode_name?,
 *     advance_paid?:        { amount, method: "cash" | "upi" }   // optional
 *   }
 *
 * Server enforces:
 *   - staff is restricted to their own location
 *   - no overlapping running/scheduled session or confirmed booking on the
 *     same table in the requested window
 *   - booking + order_item + order + (optional) payment row written atomically
 *     (best-effort, no native transactions over edge HTTP — rolls back the
 *     order if any later step fails)
 */
const schema = z.object({
  location_id:        z.string().uuid(),
  customer_name:      z.string().min(1).max(100),
  customer_phone:     z.string().regex(/^\d{10}$/, "Phone must be exactly 10 digits"),
  table_id:           z.string().uuid(),
  scheduled_start:    z.string().datetime(),
  scheduled_end:      z.string().datetime(),
  rate_per_hour:      z.number().positive(),
  num_people:         z.number().int().positive().max(20).optional(),
  selected_mode_name: z.string().optional(),
  advance_paid:       z.object({
    amount: z.number().positive(),
    method: z.enum(["cash", "upi"]),
  }).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }
  const { location_id, customer_name, customer_phone, table_id, scheduled_start, scheduled_end, rate_per_hour, num_people, selected_mode_name, advance_paid } = parsed.data;

  const admin = createAdminClient();
  const { data: viewer } = await admin
    .from("users").select("role, location_id").eq("id", session.user.id).single();
  if (!viewer || (viewer.role !== "owner" && viewer.role !== "staff")) {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }
  if (viewer.role === "staff" && viewer.location_id !== location_id) {
    return NextResponse.json(err("This location belongs to a different staff", "FORBIDDEN"), { status: 403 });
  }

  // Basic sanity — end must be after start, within a reasonable window
  const startMs = new Date(scheduled_start).getTime();
  const endMs   = new Date(scheduled_end).getTime();
  if (!(endMs > startMs)) {
    return NextResponse.json(err("Booking end must be after start", "VALIDATION_ERROR"), { status: 400 });
  }
  const durationMins = Math.round((endMs - startMs) / 60000);
  if (durationMins < 15 || durationMins > 480) {
    return NextResponse.json(err("Duration must be 15-480 min", "VALIDATION_ERROR"), { status: 400 });
  }

  // ── Conflict check (per-table, no pool logic) ─────────────────────────────
  const [{ data: existingItems }, { data: existingBookings }] = await Promise.all([
    admin
      .from("order_items")
      .select("id, table_id, actual_start, expected_end, scheduled_start, scheduled_end, status")
      .eq("table_id", table_id)
      .eq("is_deleted", false)
      .in("status", ["running", "scheduled"]),
    admin
      .from("bookings")
      .select("scheduled_start, scheduled_end, order_item:order_items!inner(id, table_id)")
      .eq("status", "confirmed")
      .eq("order_items.table_id", table_id),
  ]);

  const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && aE > bS;
  const processedItemIds = new Set<string>();
  let isConflict = false;

  for (const ex of (existingItems ?? [])) {
    const exS = ex.status === "running" ? ex.actual_start : ex.scheduled_start;
    const exE = ex.status === "running" ? ex.expected_end : ex.scheduled_end;
    if (exS && exE && overlaps(startMs, endMs, new Date(exS).getTime(), new Date(exE).getTime())) {
      isConflict = true;
      if (ex.id) processedItemIds.add(ex.id);
      break;
    }
  }

  if (!isConflict) {
    for (const b of (existingBookings ?? [])) {
      if (!b.scheduled_start || !b.scheduled_end) continue;
      if (!overlaps(startMs, endMs, new Date(b.scheduled_start).getTime(), new Date(b.scheduled_end).getTime())) continue;
      const oi = b.order_item as unknown as { id: string; table_id: string } | null;
      if (!oi) continue;
      if (oi.id && processedItemIds.has(oi.id)) continue;
      isConflict = true;
      break;
    }
  }

  if (isConflict) {
    return NextResponse.json(err("Conflict: that table already has a session or booking in this window", "TABLE_TAKEN"), { status: 409 });
  }


  // ── Create order ──────────────────────────────────────────────────────────
  const nowIso  = new Date().toISOString();
  const advanceAmount = advance_paid?.amount ?? 0;

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      location_id,
      type:           "online" as const,   // reuses the online schema — staff creating on behalf of caller
      customer_name,
      customer_phone,
      created_by:     session.user.id,
      advance_paid:   advanceAmount,
    })
    .select("id")
    .single();
  if (orderError || !order) {
    return NextResponse.json(err(orderError?.message ?? "Failed to create order", "DB_ERROR"), { status: 500 });
  }

  // ── Create order_item (scheduled) + booking + (optional) payment + profile
  //     in parallel; if any fails we roll the order back to keep state clean.
  const { data: orderItem, error: itemError } = await admin
    .from("order_items")
    .insert({
      order_id:                order.id,
      table_id,
      rate_per_hour,
      num_people:              num_people ?? null,
      scheduled_start,
      scheduled_end,
      scheduled_duration_mins: durationMins,
      selected_mode_name:      selected_mode_name ?? null,
      status:                  "scheduled" as const,
    })
    .select("id")
    .single();
  if (itemError || !orderItem) {
    await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    return NextResponse.json(err(itemError?.message ?? "Failed to create order item", "DB_ERROR"), { status: 500 });
  }

  // held_until matches the online-checkout convention — 15 min grace past
  // the slot start before the holder forfeits. Manual bookings inherit the
  // same rule so the no-show flow works uniformly.
  const heldUntilIso = new Date(startMs + 15 * 60 * 1000).toISOString();
  const bookingPromise = admin.from("bookings").insert({
    order_id:        order.id,
    order_item_id:   orderItem.id,
    scheduled_start,
    scheduled_end,
    held_until:      heldUntilIso,
    status:          "confirmed" as const,
  });

  const profilePromise = admin.from("customer_profiles").upsert(
    { phone: customer_phone, name: customer_name },
    { onConflict: "phone", ignoreDuplicates: false }
  );

  const paymentPromise = advance_paid
    ? admin.from("payments").insert({
        order_id:     order.id,
        amount:       advance_paid.amount,
        method:       advance_paid.method,
        status:       "completed" as const,
        collected_by: session.user.id,
        collected_at: nowIso,
      })
    : Promise.resolve({ error: null } as { error: null });

  const [{ error: bookingErr }, , { error: payErr }] = await Promise.all([
    bookingPromise, profilePromise, paymentPromise,
  ]);

  if (bookingErr || payErr) {
    // Roll back the order so we don't leak a dangling no-booking record
    await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    return NextResponse.json(err(bookingErr?.message ?? payErr?.message ?? "Failed to finalize booking", "DB_ERROR"), { status: 500 });
  }

  // Trigger WhatsApp notification asynchronously so staff doesn't wait
  sendWhatsAppConfirmation(order.id).catch((e) => {
    console.error("[WhatsApp] Failed to send manual booking confirmation:", e);
  });

  return NextResponse.json(ok({ order_id: order.id, order_item_id: orderItem.id }));
}
