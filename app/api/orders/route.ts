import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOrderSchema, ok, err } from "@/lib/validators/schemas";
import { checkConsolePoolConflict, isConsoleTable } from "@/lib/utils";

export const runtime = 'edge';


export async function POST(request: Request) {
  const body: unknown = await request.json();
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }


  const { location_id, type, customer_name, customer_phone, membership_id, items, points_redeemed, coupon_code, payment_mode } = parsed.data;

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

    // Load all active tables in location to map console/simulator capacity pools
    const { data: rawAllTables } = await admin
      .from("tables")
      .select("id, name, type, people_pricing")
      .eq("location_id", location_id)
      .eq("is_active", true);

    const allTables = (rawAllTables ?? []) as Array<{ id: string; name: string; type: string; people_pricing?: Record<string, unknown> | null }>;
    const consoleTableIds = allTables.filter((t) => isConsoleTable(t)).map((t) => t.id);
    const queryTableIds = [...new Set([...tableIds, ...consoleTableIds])];


    const [{ data: existingItems }, { data: existingBookings }] = await Promise.all([
      admin
        .from("order_items")
        .select("id, table_id, actual_start, expected_end, scheduled_start, scheduled_end, status, num_people")
        .in("table_id", queryTableIds)
        .eq("is_deleted", false)
        .in("status", ["running", "scheduled"]),
      admin
        .from("bookings")
        .select("scheduled_start, scheduled_end, order_item:order_items!inner(id, table_id, num_people)")
        .eq("status", "confirmed")
        .in("order_items.table_id", queryTableIds),
    ]);

    const overlaps = (aS: string, aE: string, bS: string, bE: string) =>
      new Date(aS).getTime() < new Date(bE).getTime() &&
      new Date(aE).getTime() > new Date(bS).getTime();

    for (const req of scheduledItems) {
      const reqS = req.scheduled_start!;
      const reqE = req.scheduled_end!;

      const reqTable = allTables?.find((t) => t.id === req.table_id);
      if (!reqTable) continue;

      const occupiedItems: Array<{ tableId: string; numPeople?: number | null }> = [];
      const processedItemIds = new Set<string>();

      (existingItems ?? []).forEach((ex) => {
        const exS = ex.status === "running" ? ex.actual_start : ex.scheduled_start;
        const exE = ex.status === "running" ? ex.expected_end : ex.scheduled_end;
        if (exS && exE && overlaps(reqS, reqE, exS, exE)) {
          if (ex.id) processedItemIds.add(ex.id);
          occupiedItems.push({ tableId: ex.table_id, numPeople: ex.num_people });
        }
      });

      (existingBookings ?? []).forEach((b) => {
        if (b.scheduled_start && b.scheduled_end && overlaps(reqS, reqE, b.scheduled_start, b.scheduled_end)) {
          const oi = b.order_item as unknown as { id: string; table_id: string; num_people?: number | null } | null;
          if (oi?.table_id) {
            if (oi.id && processedItemIds.has(oi.id)) return;
            if (oi.id) processedItemIds.add(oi.id);
            occupiedItems.push({ tableId: oi.table_id, numPeople: oi.num_people });
          }
        }
      });


      let isConflict = false;
      if (!isConsoleTable(reqTable)) {
        isConflict = occupiedItems.some((item) => item.tableId === req.table_id);
      } else {
        isConflict = checkConsolePoolConflict({
          reqTableId: req.table_id,
          reqNumPeople: req.num_people ?? 1,
          allTables: (allTables ?? []) as Array<{ id: string; name: string; type: string }>,
          occupiedItems,
        });
      }

      if (isConflict) {
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

  // Calculate total cost of scheduled items
  const totalCost = scheduledItems.reduce((sum, item) => {
    const start = new Date(item.scheduled_start!);
    const end = new Date(item.scheduled_end!);
    const hrs = (end.getTime() - start.getTime()) / (3600 * 1000);
    const itemRate = Number(item.rate_per_hour) || 0;
    return sum + (itemRate * hrs);
  }, 0);

  const roundedSubtotal = Math.round(totalCost * 100) / 100;
  let discountAmount = 0;

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

    // Calculate coupon discount
    if (coupon.discount_type === "flat") {
      discountAmount = Math.min(Number(coupon.discount_value), roundedSubtotal);
    } else {
      discountAmount = (roundedSubtotal * Number(coupon.discount_value)) / 100;
    }
    discountAmount = Math.round(discountAmount * 100) / 100;
  }

  // Create order
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      location_id,
      type,
      customer_name,
      customer_phone:  customer_phone ?? null,
      membership_id:   membership_id ?? null,
      points_redeemed: points_redeemed ?? 0,
      coupon_id:       resolvedCouponId,
      subtotal:        roundedSubtotal > 0 ? roundedSubtotal : null,
      discount_amount: discountAmount,
      total_amount:    roundedSubtotal > 0 ? Math.max(0, Math.round((roundedSubtotal - discountAmount) * 100) / 100) : null,
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
        free_hours_to_redeem: item.free_hours_to_redeem ?? null,
        membership_id: item.membership_id ?? null,
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
