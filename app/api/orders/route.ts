import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOrderSchema, ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';


export async function POST(request: Request) {
  const body: unknown = await request.json();
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { location_id, type, customer_name, customer_phone, items, points_redeemed, coupon_code, payment_mode } = parsed.data;

  // Online orders: public customers aren't logged in, use admin client
  // Walk-in orders: require staff authentication
  const admin = createAdminClient();
  let createdBy: string | null = null;

  if (type === "walk_in") {
    const serverClient = await createClient();
    const { data: { session } } = await serverClient.auth.getSession();
    if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });
    createdBy = session.user.id;
  }

  // ── Conflict check ────────────────────────────────────────────────────────
  // Re-verify every requested slot is still free at the moment of booking.
  // The cart-side "expired-slot" guard only checks past-time; this catches
  // the race where a walk-in or another booking grabbed the same slot
  // between cart-add and checkout-submit.
  const scheduledItems = items.filter((i) => i.scheduled_start && i.scheduled_end);
  if (scheduledItems.length > 0) {
    const tableIds = [...new Set(scheduledItems.map((i) => i.table_id))];

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

    for (const req of scheduledItems) {
      const reqS = req.scheduled_start!;
      const reqE = req.scheduled_end!;

      const itemConflict = (existingItems ?? []).find((ex) => {
        if (ex.table_id !== req.table_id) return false;
        const exS = ex.status === "running" ? ex.actual_start : ex.scheduled_start;
        const exE = ex.status === "running" ? ex.expected_end : ex.scheduled_end;
        return exS && exE && overlaps(reqS, reqE, exS, exE);
      });
      if (itemConflict) {
        return NextResponse.json(
          err(
            "Looks like that slot was just booked by someone else. Please go back and pick a different time.",
            "SLOT_TAKEN"
          ),
          { status: 409 }
        );
      }

      const bookingConflict = (existingBookings ?? []).find((b) => {
        const tableId = (b.order_item as unknown as { table_id: string } | null)?.table_id;
        return tableId === req.table_id && overlaps(reqS, reqE, b.scheduled_start, b.scheduled_end);
      });
      if (bookingConflict) {
        return NextResponse.json(
          err(
            "Looks like that slot was just booked by someone else. Please go back and pick a different time.",
            "SLOT_TAKEN"
          ),
          { status: 409 }
        );
      }
    }
  }

  // ── Validate coupon (if provided) and resolve coupon_id to attach ────────
  // Server is the source of truth — UI may have validated, but we re-check
  // every rule here so a tampered request can't sneak through.
  let resolvedCouponId: string | null = null;
  if (coupon_code) {
    if (type === "online" && payment_mode !== "full") {
      return NextResponse.json(err("Coupons are only available for online bookings that are fully paid", "INVALID_COUPON"), { status: 400 });
    }
    const normalized = coupon_code.trim().toUpperCase();
    const { data: coupon } = await admin
      .from("coupons")
      .select("*")
      .eq("code", normalized)
      .maybeSingle();

    if (!coupon || !coupon.is_active) {
      return NextResponse.json(err("Coupon code is not valid", "INVALID_COUPON"), { status: 400 });
    }
    const nowMs = Date.now();
    if (coupon.valid_from && new Date(coupon.valid_from).getTime() > nowMs) {
      return NextResponse.json(err("Coupon is not active yet", "INVALID_COUPON"), { status: 400 });
    }
    if (coupon.valid_until && new Date(coupon.valid_until).getTime() < nowMs) {
      return NextResponse.json(err("Coupon has expired", "INVALID_COUPON"), { status: 400 });
    }
    if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
      return NextResponse.json(err("Coupon has reached its usage limit", "INVALID_COUPON"), { status: 400 });
    }
    if (coupon.location_id && coupon.location_id !== location_id) {
      return NextResponse.json(err("Coupon is not valid at this location", "INVALID_COUPON"), { status: 400 });
    }
    resolvedCouponId = coupon.id;
  }

  // Create order
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      location_id,
      type,
      customer_name,
      customer_phone:  customer_phone ?? null,
      points_redeemed: points_redeemed ?? 0,
      coupon_id:       resolvedCouponId,
      created_by:      createdBy,
    })
    .select()
    .single();

  if (orderError || !order) {
    return NextResponse.json(err(orderError?.message ?? "Failed to create order", "DB_ERROR"), { status: 500 });
  }

  // Create order items — select back IDs and schedule times for bookings
  const { data: createdItems, error: itemsError } = await admin
    .from("order_items")
    .insert(
      items.map((item) => ({
        order_id: order.id,
        table_id: item.table_id,
        scheduled_start: item.scheduled_start ?? null,
        scheduled_end: item.scheduled_end ?? null,
        scheduled_duration_mins: item.scheduled_duration_mins ?? null,
        rate_per_hour: item.rate_per_hour,
        num_people:    item.num_people ?? null,
      }))
    )
    .select("id, table_id, scheduled_start, scheduled_end");

  if (itemsError || !createdItems) {
    await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    return NextResponse.json(err(itemsError?.message ?? "Failed to create order items", "DB_ERROR"), { status: 500 });
  }

  // Run bookings insert and customer profile upsert in parallel
  const bookingsPromise = (type === "online") ? (() => {
    const bookings = createdItems
      .filter((item) => item.scheduled_start && item.scheduled_end)
      .map((item) => ({
        order_id: order.id,
        order_item_id: item.id,
        scheduled_start: item.scheduled_start!,
        scheduled_end: item.scheduled_end!,
        held_until: new Date(new Date(item.scheduled_start!).getTime() + 15 * 60 * 1000).toISOString(),
        status: "confirmed" as const,
      }));
    return bookings.length > 0 ? admin.from("bookings").insert(bookings) : Promise.resolve();
  })() : Promise.resolve();

  const profilePromise = customer_phone
    ? admin.from("customer_profiles").upsert(
        { phone: customer_phone, name: customer_name },
        { onConflict: "phone", ignoreDuplicates: false }
      )
    : Promise.resolve();

  await Promise.all([bookingsPromise, profilePromise]);

  return NextResponse.json(ok({
    order_id: order.id,
    items: createdItems.map((i) => ({ id: i.id, table_id: i.table_id })),
  }));
}
