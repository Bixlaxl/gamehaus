import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOrderSchema, ok, err } from "@/lib/validators/schemas";
import { cancelExpiredUnpaidOrders } from "@/lib/booking-cleanup";

export const runtime = 'edge';


function fuzzyMatch(name1: string, name2: string): boolean {
  const norm1 = name1.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  const norm2 = name2.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

  if (norm1 === norm2) return true;
  if (!norm1 || !norm2) return false;

  const tokens1 = norm1.split(" ");
  const tokens2 = norm2.split(" ");

  const all1In2 = tokens1.every(t => tokens2.includes(t));
  const all2In1 = tokens2.every(t => tokens1.includes(t));
  if (all1In2 || all2In1) return true;

  const getLevenshteinDistance = (a: string, b: string): number => {
    const tmp: number[][] = [];
    for (let i = 0; i <= a.length; i++) {
      tmp[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
      tmp[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        tmp[i][j] = Math.min(
          tmp[i - 1][j] + 1,
          tmp[i][j - 1] + 1,
          tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return tmp[a.length][b.length];
  };

  const dist = getLevenshteinDistance(norm1, norm2);
  const maxLen = Math.max(norm1.length, norm2.length);
  const allowedDist = maxLen <= 5 ? 1 : maxLen <= 10 ? 2 : 3;
  
  return dist <= allowedDist;
}

export async function POST(request: Request) {
  const body: unknown = await request.json();
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }


  const { location_id, type, customer_name, customer_phone, membership_id, items, extras, points_redeemed, coupon_code, payment_mode } = parsed.data;

  // Online orders: public customers aren't logged in, use admin client
  // Walk-in orders: require staff authentication
  const admin = createAdminClient();

  // Verify location is active
  const { data: location, error: locError } = await admin
    .from("locations")
    .select("is_active")
    .eq("id", location_id)
    .maybeSingle();

  if (locError) {
    return NextResponse.json(err(locError.message, "DB_ERROR"), { status: 500 });
  }
  if (!location) {
    return NextResponse.json(err("Location not found", "NOT_FOUND"), { status: 404 });
  }
  if (!location.is_active) {
    return NextResponse.json(
      err("Bookings are disabled because this location is currently deactivated", "LOCATION_INACTIVE"),
      { status: 400 }
    );
  }

  let createdBy: string | null = null;

  if (type === "walk_in") {
    const serverClient = await createClient();
    const { data: { session } } = await serverClient.auth.getSession();
    if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });
    createdBy = session.user.id;
  }

  // Backend gatekeeper check for online checkout name and phone combination
  if (type === "online" && customer_phone) {
    const { data: profile } = await admin
      .from("customer_profiles")
      .select("name")
      .eq("phone", customer_phone)
      .maybeSingle();
    
    if (profile && profile.name) {
      if (!fuzzyMatch(customer_name, profile.name)) {
        return NextResponse.json(
          err(
            "The name and phone number combination entered does not match our records. Please verify your details or contact support.",
            "NAME_MISMATCH"
          ),
          { status: 400 }
        );
      }
    }
  }

  // ── Conflict check ────────────────────────────────────────────────────────
  await cancelExpiredUnpaidOrders();
  // Re-verify every requested slot is still free at the moment of booking.
  const scheduledItems = items.filter((i) => i.scheduled_start && i.scheduled_end);
  if (scheduledItems.length > 0) {
    const tableIds = [...new Set(scheduledItems.map((i) => i.table_id))];

    const [{ data: existingItems }, { data: existingBookings }] = await Promise.all([
      admin
        .from("order_items")
        .select("id, table_id, actual_start, expected_end, scheduled_start, scheduled_end, status")
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

    for (const req of scheduledItems) {
      const reqS = req.scheduled_start!;
      const reqE = req.scheduled_end!;

      // Build deduplicated occupied list for THIS table only
      const processedItemIds = new Set<string>();
      let isConflict = false;

      for (const ex of (existingItems ?? [])) {
        if (ex.table_id !== req.table_id) continue;
        const exS = ex.status === "running" ? ex.actual_start : ex.scheduled_start;
        const exE = ex.status === "running" ? ex.expected_end : ex.scheduled_end;
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
    if (type !== "online" || payment_mode !== "full") {
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

  let publicDiscountAmount = discountAmount;
  let memberDiscountAmount = 0;

  if (customer_phone || membership_id) {
    const nowISO = new Date().toISOString();
    let targetPhone = customer_phone;
    
    if (membership_id) {
      const { data: matchedRow } = await admin
        .from("customer_memberships")
        .select("customer_phone")
        .eq("id", membership_id)
        .limit(1)
        .maybeSingle();
      if (matchedRow) {
        targetPhone = matchedRow.customer_phone;
      }
    }

    let query = admin
      .from("customer_memberships")
      .select("*, plan:membership_plans(*)")
      .eq("is_active", true)
      .gte("expires_at", nowISO);
    
    if (targetPhone) {
      query = query.eq("customer_phone", targetPhone);
    } else {
      // Force empty if neither targetPhone nor membership_id is valid
      query = query.eq("id", "00000000-0000-0000-0000-000000000000");
    }
    const { data: memberShipList } = await query;
    if (memberShipList && memberShipList.length > 0) {
      const bookedTableIds = scheduledItems.map((i) => i.table_id);
      let highestMemberPct = 0;

      for (const m of memberShipList) {
        const planPct = Number(m.plan?.discount_pct || 0);
        if (planPct <= 0) continue;
        const boundIds: string[] = m.bound_table_ids || m.plan?.bound_table_ids || [];
        const isApplicable = boundIds.length === 0 || bookedTableIds.some((id) => boundIds.includes(id));
        if (isApplicable && planPct > highestMemberPct) {
          highestMemberPct = planPct;
        }
      }

      if (highestMemberPct > 0) {
        const netAfterPublic = Math.max(0, roundedSubtotal - publicDiscountAmount);
        memberDiscountAmount = Math.round((netAfterPublic * highestMemberPct) / 100 * 100) / 100;
      }
    }
  }

  discountAmount = Math.round((publicDiscountAmount + memberDiscountAmount) * 100) / 100;

  // Create order
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      location_id,
      type,
      customer_name,
      customer_phone:         customer_phone ?? null,
      membership_id:          membership_id ?? null,
      points_redeemed:        points_redeemed ?? 0,
      coupon_id:              resolvedCouponId,
      subtotal:               roundedSubtotal > 0 ? roundedSubtotal : null,
      // discount_amount = coupon + member combined (for reporting/display).
      // public_discount_amount = coupon portion ONLY — used at finalize so the
      // billing engine can apply member % live (covering extensions + extras)
      // without double-counting the member portion baked in at booking time.
      discount_amount:        discountAmount,
      public_discount_amount: publicDiscountAmount,
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
        selected_mode_name: item.selected_mode_name ?? null,
      }))
    )
    .select("id, table_id, scheduled_start, scheduled_end");

  if (itemsError || !createdItems) {
    await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    return NextResponse.json(err(itemsError?.message ?? "Failed to create order items", "DB_ERROR"), { status: 500 });
  }

  // Run bookings insert and customer profile upsert in parallel
  const bookingsPromise = (type === "walk_in") ? (() => {
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

  const extrasPromise = (extras && extras.length > 0) ? (async () => {
    const itemIds = extras.map(e => e.inventory_item_id);
    const { data: invItems } = await admin
      .from("inventory_items")
      .select("id, name, selling_price, cost_price, stock_count")
      .in("id", itemIds);
    if (!invItems || invItems.length === 0) return;

    const toInsert = [];
    for (const ex of extras) {
      const inv = invItems.find(i => i.id === ex.inventory_item_id);
      if (!inv) continue;
      toInsert.push({
        order_id: order.id,
        inventory_item_id: inv.id,
        name: inv.name,
        price: inv.selling_price,
        cost_price: inv.cost_price ?? 0,
        quantity: ex.quantity,
      });
      // Deduct stock quantity
      const newStock = Math.max(0, inv.stock_count - ex.quantity);
      await admin.from("inventory_items").update({ stock_count: newStock }).eq("id", inv.id);
    }
    if (toInsert.length > 0) {
      await admin.from("order_extras").insert(toInsert);
    }
  })() : Promise.resolve();

  await Promise.all([bookingsPromise, profilePromise, extrasPromise]);

  return NextResponse.json(ok({
    order_id: order.id,
    items: createdItems.map((i) => ({ id: i.id, table_id: i.table_id })),
  }));
}
