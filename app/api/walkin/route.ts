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
    table_id:      z.string().uuid(),
    duration_mins: z.number().int().min(15).max(480),
    rate_per_hour: z.number().positive(),
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

  // ── Enforce operating hours ────────────────────────────────────────────
  const { data: loc } = await admin
    .from("locations")
    .select("opening_time, closing_time")
    .eq("id", location_id)
    .single();

  if (loc?.opening_time && loc?.closing_time) {
    const [oh, om] = loc.opening_time.split(":").map(Number);
    const [ch, cm] = loc.closing_time.split(":").map(Number);
    const crossesMidnight = (ch * 60 + cm) <= (oh * 60 + om);
    const opens  = new Date(now); opens.setHours(oh, om, 0, 0);
    const closes = new Date(now); closes.setHours(ch, cm, 0, 0);
    let opensMs:  number;
    let closesMs: number;
    if (!crossesMidnight) {
      opensMs  = opens.getTime();
      closesMs = closes.getTime();
    } else {
      const nowMins   = now.getHours() * 60 + now.getMinutes();
      const closeMins = ch * 60 + cm;
      if (nowMins < closeMins) {
        opensMs  = opens.getTime()  - 24 * 60 * 60 * 1000;
        closesMs = closes.getTime();
      } else {
        opensMs  = opens.getTime();
        closesMs = closes.getTime() + 24 * 60 * 60 * 1000;
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
    // Cap each item's duration so the session can't run past closing
    const minsUntilClose = Math.floor((closesMs - now.getTime()) / 60000);
    const overflow = items.find((i) => i.duration_mins > minsUntilClose);
    if (overflow) {
      return NextResponse.json(
        err(`Walk-in duration exceeds shop closing — only ${minsUntilClose} min available`, "PAST_CLOSING"),
        { status: 409 }
      );
    }
  }

  // ── Conflict check ────────────────────────────────────────────────────────
  // Walk-in occupies [now, now + duration_mins]. Reject if any other running/
  // scheduled session or confirmed booking on the same table overlaps that
  // window. Handles the race where a customer's online booking lands between
  // PanelWalkIn rendering and Start being pressed.
  const tableIds = [...new Set(items.map((i) => i.table_id))];
  const [{ data: existingItems }, { data: existingBookings }] = await Promise.all([
    admin
      .from("order_items")
      .select("table_id, actual_start, expected_end, scheduled_start, scheduled_end, status")
      .in("table_id", tableIds)
      .eq("is_deleted", false)
      .in("status", ["running", "scheduled"]),
    admin
      .from("bookings")
      .select("scheduled_start, scheduled_end, order_item:order_items!inner(table_id)")
      .eq("status", "confirmed")
      .in("order_items.table_id", tableIds),
  ]);

  const overlaps = (aS: string, aE: string, bS: string, bE: string) =>
    new Date(aS).getTime() < new Date(bE).getTime() &&
    new Date(aE).getTime() > new Date(bS).getTime();

  for (const req of items) {
    const reqS = now.toISOString();
    const reqE = new Date(now.getTime() + req.duration_mins * 60 * 1000).toISOString();

    const itemConflict = (existingItems ?? []).find((ex) => {
      if (ex.table_id !== req.table_id) return false;
      const exS = ex.status === "running" ? ex.actual_start : ex.scheduled_start;
      const exE = ex.status === "running" ? ex.expected_end : ex.scheduled_end;
      return exS && exE && overlaps(reqS, reqE, exS, exE);
    });
    if (itemConflict) {
      return NextResponse.json(
        err("This table was just booked — pick a different table or shorter duration.", "TABLE_TAKEN"),
        { status: 409 }
      );
    }

    const bookingConflict = (existingBookings ?? []).find((b) => {
      const tableId = (b.order_item as unknown as { table_id: string } | null)?.table_id;
      return tableId === req.table_id && overlaps(reqS, reqE, b.scheduled_start, b.scheduled_end);
    });
    if (bookingConflict) {
      return NextResponse.json(
        err("This table was just booked — pick a different table or shorter duration.", "TABLE_TAKEN"),
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
