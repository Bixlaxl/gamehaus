import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";
import { calculateBill } from "@/lib/billing/engine";
import { z } from "zod";
import type { OrderItem, OrderExtra, Coupon } from "@/lib/supabase/types";

export const runtime = 'edge';


const schema = z.object({
  payment_method:  z.enum(["cash", "upi"]),
  coupon_code:     z.string().optional(),
  points_redeemed: z.number().int().min(0).optional().default(0),
  customer_phone:  z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });
  const user = session.user;

  const body: unknown = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { payment_method, coupon_code, points_redeemed, customer_phone: phoneOverride } = parsed.data;
  const admin = createAdminClient();

  // Fetch full order via admin client (bypasses RLS — works for both walk-in and online orders)
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("*, coupon:coupons(*)")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return NextResponse.json(err("Order not found", "NOT_FOUND"), { status: 404 });
  }
  if (order.status !== "open") {
    return NextResponse.json(err("Order is not open", "INVALID_STATE"), { status: 400 });
  }

  // Ensure all items are finished
  const { data: items } = await admin
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .eq("is_deleted", false);

  const activeItems = (items ?? []).filter((i) => i.status !== "cancelled");
  if (activeItems.some((i) => i.status === "running")) {
    return NextResponse.json(
      err("Stop all running sessions before finalizing", "SESSIONS_RUNNING"),
      { status: 400 }
    );
  }

  // Fetch extras
  const { data: extras } = await admin
    .from("order_extras")
    .select("*")
    .eq("order_id", orderId)
    .eq("is_deleted", false);

  // If staff entered a phone at finalize time (walk-in without phone), save it to the order
  const effectivePhone = order.customer_phone ?? phoneOverride ?? null;
  if (phoneOverride && !order.customer_phone) {
    await admin.from("orders").update({ customer_phone: phoneOverride }).eq("id", orderId);
  }

  // Resolve coupon
  let coupon: Coupon | null = order.coupon as Coupon | null;
  if (coupon_code && !coupon) {
    const { data: c } = await admin
      .from("coupons")
      .select("*")
      .eq("code", coupon_code.toUpperCase())
      .eq("is_active", true)
      .single();
    coupon = c ?? null;
  }

  const now = new Date();
  const bill = calculateBill(
    activeItems as OrderItem[],
    (extras ?? []) as OrderExtra[],
    now,
    coupon,
    order.advance_paid
  );

  // Validate points — customer must have enough
  let validatedPoints = points_redeemed;
  if (validatedPoints > 0 && effectivePhone) {
    const { data: profile } = await admin
      .from("customer_profiles")
      .select("points_balance")
      .eq("phone", effectivePhone)
      .single();

    const balance = profile?.points_balance ?? 0;
    validatedPoints = Math.min(validatedPoints, balance, Math.floor(bill.totalDue));
  } else {
    validatedPoints = 0;
  }

  // Apply points discount on top of what calculateBill returned
  const finalDue    = Math.max(0, Math.round((bill.totalDue - validatedPoints) * 100) / 100);
  const pointsEarned = Math.floor(finalDue / 100);

  // Update order with final amounts
  const { error: finalizeError } = await admin
    .from("orders")
    .update({
      status:          "finalized",
      subtotal:        bill.subtotal,
      discount_amount: bill.discountAmount,
      total_amount:    bill.subtotal - bill.discountAmount,
      amount_due:      finalDue,
      points_redeemed: validatedPoints,
      finalized_at:    now.toISOString(),
      coupon_id:       coupon?.id ?? order.coupon_id,
    })
    .eq("id", orderId);

  if (finalizeError) {
    return NextResponse.json(err(finalizeError.message, "DB_ERROR"), { status: 500 });
  }

  // Create payment record
  const { error: paymentError } = await admin.from("payments").insert({
    order_id:     orderId,
    amount:       finalDue,
    method:       payment_method,
    status:       "completed",
    collected_by: user.id,
    collected_at: now.toISOString(),
  });

  if (paymentError) {
    return NextResponse.json(err(paymentError.message, "DB_ERROR"), { status: 500 });
  }

  // Run coupon increment and customer profile fetch in parallel
  const [, profileResult] = await Promise.all([
    coupon
      ? admin.from("coupons").update({ used_count: coupon.used_count + 1 }).eq("id", coupon.id)
      : Promise.resolve(null),
    effectivePhone
      ? admin.from("customer_profiles").select("points_balance, visit_count, total_spent").eq("phone", effectivePhone).single()
      : Promise.resolve(null),
  ]);

  if (effectivePhone) {
    const profile = (profileResult as { data: { points_balance: number; visit_count: number; total_spent: number } | null } | null)?.data ?? null;
    if (profile) {
      await admin
        .from("customer_profiles")
        .update({
          points_balance: Math.max(0, profile.points_balance - validatedPoints + pointsEarned),
          visit_count:    profile.visit_count + 1,
          total_spent:    profile.total_spent + finalDue,
          last_visit_at:  now.toISOString(),
        })
        .eq("phone", effectivePhone);
    } else {
      await admin.from("customer_profiles").insert({
        phone:          effectivePhone,
        name:           order.customer_name,
        points_balance: pointsEarned,
        visit_count:    1,
        total_spent:    finalDue,
        last_visit_at:  now.toISOString(),
      });
    }
  }

  return NextResponse.json(ok({
    total_due:      finalDue,
    points_redeemed: validatedPoints,
    points_earned:   pointsEarned,
  }));
}
