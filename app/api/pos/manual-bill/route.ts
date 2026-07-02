import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";
import { getAppSettings } from "@/lib/settings";
import { z } from "zod";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  location_id:     z.string().uuid(),
  customer_name:   z.string().min(1),
  customer_phone:  z.string().optional(),
  table_sessions:  z.array(z.object({
    table_id:      z.string().uuid(),
    rate_per_hour: z.number().positive(),
    start:         z.string().datetime({ offset: true }),
    end:           z.string().datetime({ offset: true }),
  })).optional().default([]),
  extras: z.array(z.object({
    inventory_item_id: z.string().uuid().optional(),
    name:              z.string().min(1),
    price:             z.number().nonnegative(),
    quantity:          z.number().int().positive(),
  })).optional().default([]),
  payments: z.array(z.object({
    method: z.enum(["cash", "upi"]),
    amount: z.number().nonnegative(),
  })).min(1),
  points_redeemed: z.number().int().min(0).optional().default(0),
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

  const { location_id, customer_name, customer_phone, table_sessions, extras, payments, points_redeemed } = parsed.data;

  // Validate at least sessions or extras provided
  if (table_sessions.length === 0 && extras.length === 0) {
    return NextResponse.json(err("Provide at least one table session or item", "VALIDATION_ERROR"), { status: 400 });
  }

  // Validate each session has end > start
  for (const s of table_sessions) {
    const startMs = new Date(s.start).getTime();
    const endMs   = new Date(s.end).getTime();
    if (endMs <= startMs) {
      return NextResponse.json(err("Session end time must be after start time", "VALIDATION_ERROR"), { status: 400 });
    }
  }

  const admin = createAdminClient();
  const settings = await getAppSettings(admin);
  const earnRate   = settings.loyalty.earn_rupees_per_point;
  const redeemRate = settings.loyalty.redeem_rupees_per_point;
  const minToRedeem = settings.loyalty.min_points_to_redeem ?? 100;

  // Calculate table session amounts
  let sessionTotal = 0;
  const sessionAmounts = table_sessions.map((s) => {
    const durationHrs = (new Date(s.end).getTime() - new Date(s.start).getTime()) / 3_600_000;
    const amount = Math.round(durationHrs * s.rate_per_hour * 100) / 100;
    sessionTotal += amount;
    return { ...s, amount };
  });

  // Calculate extras total
  let extrasTotal = 0;
  for (const e of extras) {
    extrasTotal += e.price * e.quantity;
  }
  extrasTotal = Math.round(extrasTotal * 100) / 100;

  const subtotal = Math.round((sessionTotal + extrasTotal) * 100) / 100;

  // Validate + cap points redemption
  let validatedPoints = points_redeemed;
  if (validatedPoints > 0 && customer_phone) {
    const { data: profile } = await admin
      .from("customer_profiles")
      .select("points_balance")
      .eq("phone", customer_phone)
      .maybeSingle();

    const balance = profile?.points_balance ?? 0;
    if (balance < minToRedeem) {
      validatedPoints = 0;
    } else {
      const maxByBill = Math.floor(subtotal / redeemRate);
      validatedPoints = Math.min(validatedPoints, balance, maxByBill);
    }
  } else {
    validatedPoints = 0;
  }

  const pointsDiscount = validatedPoints * redeemRate;
  const finalDue = Math.max(0, Math.round((subtotal - pointsDiscount) * 100) / 100);

  // Validate payment total
  const paymentTotal = Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  if (Math.abs(paymentTotal - finalDue) > 1) {
    return NextResponse.json(
      err(`Payment total ₹${paymentTotal} does not match bill ₹${finalDue}`, "PAYMENT_MISMATCH"),
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  // 1. Create order (already finalized)
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      location_id,
      type:           "walk_in",
      customer_name,
      customer_phone: customer_phone ?? null,
      status:         "finalized",
      subtotal,
      discount_amount:        0,
      public_discount_amount: 0,
      total_amount:   finalDue,
      amount_due:     finalDue,
      advance_paid:   0,
      points_redeemed: validatedPoints,
      created_by:     session.user.id,
      finalized_at:   now,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    return NextResponse.json(err(orderError?.message ?? "Failed to create order", "DB_ERROR"), { status: 500 });
  }

  const orderId = order.id;

  // 2. Insert order_items (status finished immediately)
  if (sessionAmounts.length > 0) {
    const { error: itemsError } = await admin.from("order_items").insert(
      sessionAmounts.map((s) => ({
        order_id:       orderId,
        table_id:       s.table_id,
        rate_per_hour:  s.rate_per_hour,
        status:         "finished" as const,
        actual_start:   s.start,
        expected_end:   s.end,
        actual_end:     s.end,
        final_amount:   s.amount,
      }))
    );
    if (itemsError) {
      await admin.from("orders").delete().eq("id", orderId);
      return NextResponse.json(err(itemsError.message, "DB_ERROR"), { status: 500 });
    }
  }

  // 3. Insert order_extras
  if (extras.length > 0) {
    const { error: extrasError } = await admin.from("order_extras").insert(
      extras.map((e) => ({
        order_id:          orderId,
        name:              e.name,
        price:             e.price,
        quantity:          e.quantity,
        inventory_item_id: e.inventory_item_id ?? null,
        cost_price:        0,
      }))
    );
    if (extrasError) {
      await admin.from("orders").delete().eq("id", orderId);
      return NextResponse.json(err(extrasError.message, "DB_ERROR"), { status: 500 });
    }

    // Deduct inventory stock for linked items
    for (const e of extras) {
      if (!e.inventory_item_id) continue;
      const { data: inv } = await admin
        .from("inventory_items")
        .select("stock_count")
        .eq("id", e.inventory_item_id)
        .maybeSingle();
      if (inv && inv.stock_count !== null) {
        const newStock = Math.max(0, inv.stock_count - e.quantity);
        await admin.from("inventory_items").update({ stock_count: newStock }).eq("id", e.inventory_item_id);
      }
    }
  }

  // 4. Insert payments
  const { error: payError } = await admin.from("payments").insert(
    payments.map((p) => ({
      order_id: orderId,
      amount:   p.amount,
      method:   p.method,
      status:   "completed" as const,
    }))
  );
  if (payError) {
    return NextResponse.json(err(payError.message, "DB_ERROR"), { status: 500 });
  }

  // 5. Upsert customer profile
  if (customer_phone) {
    const pointsEarned = Math.floor(finalDue / earnRate);
    const { data: existing } = await admin
      .from("customer_profiles")
      .select("visit_count, total_spent, points_balance")
      .eq("phone", customer_phone)
      .maybeSingle();

    if (existing) {
      await admin.from("customer_profiles").update({
        name:           customer_name,
        visit_count:    existing.visit_count + 1,
        total_spent:    Math.round((existing.total_spent + finalDue) * 100) / 100,
        points_balance: Math.max(0, existing.points_balance - validatedPoints + pointsEarned),
        last_visit_at:  now,
      }).eq("phone", customer_phone);
    } else {
      await admin.from("customer_profiles").insert({
        phone:          customer_phone,
        name:           customer_name,
        visit_count:    1,
        total_spent:    finalDue,
        points_balance: pointsEarned,
        last_visit_at:  now,
      });
    }
  }

  return NextResponse.json(ok({ order_id: orderId, total: finalDue }));
}
