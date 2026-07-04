import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { ok, err } from "@/lib/validators/schemas";


export const runtime = 'edge';

const schema = z.object({
  location_id:    z.string().uuid(),
  customer_name:  z.string().min(1),
  customer_phone: z.string().optional(),
  items: z.array(z.object({
    table_id:           z.string().uuid(),
    duration_mins:      z.number().int().min(15).max(480),
    rate_per_hour:      z.number().positive(),
    num_people:         z.number().int().positive().max(20).optional(),
    selected_mode_name: z.string().optional(),
  })).min(1),
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

  const { location_id, customer_name, customer_phone, items } = parsed.data;
  const admin = createAdminClient();
  const now   = new Date();

  // ── Enforce operating hours & active state ─────────────────────────────
  const { data: loc } = await admin
    .from("locations")
    .select("opening_time, closing_time, is_active")
    .eq("id", location_id)
    .maybeSingle();

  if (!loc) {
    return NextResponse.json(err("Location not found", "NOT_FOUND"), { status: 404 });
  }

  if (!loc.is_active) {
    return NextResponse.json(
      err("Walk-ins are disabled because this location is currently deactivated", "LOCATION_INACTIVE"),
      { status: 400 }
    );
  }

  if (loc.opening_time && loc.closing_time) {
    const [oh, om] = loc.opening_time.split(":").map(Number);
    const [ch, cm] = loc.closing_time.split(":").map(Number);
    const crossesMidnight = (ch * 60 + cm) <= (oh * 60 + om);

    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowIst = new Date(now.getTime() + IST_OFFSET_MS);
    const y  = nowIst.getUTCFullYear();
    const mo = nowIst.getUTCMonth();
    const d  = nowIst.getUTCDate();
    const opensUtc  = Date.UTC(y, mo, d, oh, om) - IST_OFFSET_MS;
    const closesUtc = Date.UTC(y, mo, d, ch, cm) - IST_OFFSET_MS;

    let opensMs:  number;
    let closesMs: number;
    if (!crossesMidnight) {
      opensMs  = opensUtc;
      closesMs = closesUtc;
    } else {
      const nowMinsIst = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes();
      const closeMins  = ch * 60 + cm;
      if (nowMinsIst < closeMins) {
        opensMs  = opensUtc  - 24 * 60 * 60 * 1000;
        closesMs = closesUtc;
      } else {
        opensMs  = opensUtc;
        closesMs = closesUtc + 24 * 60 * 60 * 1000;
      }
    }

    if (now.getTime() < opensMs) {
      return NextResponse.json(
        err(`Shop opens at ${loc.opening_time} — walk-ins not allowed yet`, "OUTSIDE_HOURS"),
        { status: 409 }
      );
    }
    if (now.getTime() >= closesMs) {
      return NextResponse.json(
        err("Shop has closed for the day — walk-ins not allowed", "OUTSIDE_HOURS"),
        { status: 409 }
      );
    }
    const minsUntilClose = Math.floor((closesMs - now.getTime()) / 60000);
    const overflow = items.find((i) => i.duration_mins > minsUntilClose);
    if (overflow) {
      return NextResponse.json(
        err(`Walk-in duration exceeds shop closing — only ${minsUntilClose} min available`, "PAST_CLOSING"),
        { status: 409 }
      );
    }
  }

  // ── Conflict check (per-table, no pool logic) ─────────────────────────────
  const tableIds = [...new Set(items.map((i) => i.table_id))];

  const [{ data: existingItems }, { data: existingBookings }] = await Promise.all([
    admin
      .from("order_items")
      .select("id, table_id, actual_start, expected_end, status")
      .in("table_id", tableIds)
      .eq("is_deleted", false)
      .in("status", ["running", "scheduled"]),
    admin
      .from("bookings")
      .select("scheduled_start, scheduled_end, order_item:order_items!inner(id, table_id)")
      .eq("status", "confirmed")
      .in("order_items.table_id", tableIds),
  ]);

  const overlaps = (aS: string, aE: string, bS: string, bE: string) =>
    new Date(aS).getTime() < new Date(bE).getTime() &&
    new Date(aE).getTime() > new Date(bS).getTime();

  for (const req of items) {
    const reqS = now.toISOString();
    const reqE = new Date(now.getTime() + req.duration_mins * 60 * 1000).toISOString();

    const processedItemIds = new Set<string>();
    let isConflict = false;

    for (const ex of (existingItems ?? [])) {
      if (ex.table_id !== req.table_id) continue;
      const exS = ex.status === "running" ? ex.actual_start : null;
      const exE = ex.status === "running" ? ex.expected_end : null;
      if (exS && exE && overlaps(reqS, reqE, exS, exE)) {
        isConflict = true;
        if (ex.id) processedItemIds.add(ex.id);
        break;
      }
    }

    if (!isConflict) {
      for (const b of (existingBookings ?? [])) {
        if (!b.scheduled_start || !b.scheduled_end) continue;
        if (!overlaps(reqS, reqE, b.scheduled_start, b.scheduled_end)) continue;
        const oi = b.order_item as unknown as { id: string; table_id: string } | null;
        if (!oi || oi.table_id !== req.table_id) continue;
        if (oi.id && processedItemIds.has(oi.id)) continue;
        isConflict = true;
        break;
      }
    }

    if (isConflict) {
      return NextResponse.json(
        err("This table was just booked online. Pick a different table or a shorter duration.", "TABLE_TAKEN"),
        { status: 409 }
      );
    }
  }


  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      location_id,
      type:           "walk_in",
      customer_name,
      customer_phone: customer_phone ?? null,
      created_by:     session.user.id,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    return NextResponse.json(err(orderError?.message ?? "Failed to create order", "DB_ERROR"), { status: 500 });
  }

  // Insert items directly in running state — combines order creation + session start into one round trip
  const itemsPromise = admin.from("order_items").insert(
    items.map((item) => ({
      order_id:                order.id,
      table_id:                item.table_id,
      rate_per_hour:           item.rate_per_hour,
      num_people:              item.num_people ?? null,
      selected_mode_name:     item.selected_mode_name ?? null,
      scheduled_duration_mins: item.duration_mins,
      status:                  "running" as const,
      actual_start:            now.toISOString(),
      expected_end:            new Date(now.getTime() + item.duration_mins * 60 * 1000).toISOString(),
    }))
  );

  const profilePromise = customer_phone
    ? admin.from("customer_profiles").upsert(
        { phone: customer_phone, name: customer_name },
        { onConflict: "phone", ignoreDuplicates: false }
      )
    : Promise.resolve({ data: null, error: null });

  const [{ error: itemsError }] = await Promise.all([itemsPromise, profilePromise]);

  if (itemsError) {
    await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    return NextResponse.json(err(itemsError.message, "DB_ERROR"), { status: 500 });
  }

  return NextResponse.json(ok({ order_id: order.id }));
}
