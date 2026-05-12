import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/validators/schemas";
import { calculateBill } from "@/lib/billing/engine";
import { z } from "zod";
import type { OrderItem, OrderExtra, Coupon } from "@/lib/supabase/types";

const schema = z.object({
  payment_method:  z.enum(["cash", "upi", "card"]),
  coupon_code:     z.string().optional(),
  points_redeemed: z.number().int().min(0).optional().default(0),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { payment_method, coupon_code, points_redeemed } = parsed.data;

  // Fetch full order
  const { data: order, error: orderError } = await supabase
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
  const { data: items } = await supabase
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
  const { data: extras } = await supabase
    .from("order_extras")
    .select("*")
    .eq("order_id", orderId)
    .eq("is_deleted", false);

  // Resolve coupon
  let coupon: Coupon | null = order.coupon as Coupon | null;
  if (coupon_code && !coupon) {
    const { data: c } = await supabase
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
  if (validatedPoints > 0 && order.customer_phone) {
    const { data: profile } = await supabase
      .from("customer_profiles")
      .select("points_balance")
      .eq("phone", order.customer_phone)
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
  const { error: finalizeError } = await supabase
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
  const { error: paymentError } = await supabase.from("payments").insert({
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

  // Increment coupon usage
  if (coupon) {
    await supabase
      .from("coupons")
      .update({ used_count: coupon.used_count + 1 })
      .eq("id", coupon.id);
  }

  // Update customer loyalty points + profile stats
  if (order.customer_phone) {
    const { data: profile } = await supabase
      .from("customer_profiles")
      .select("points_balance, visit_count, total_spent")
      .eq("phone", order.customer_phone)
      .single();

    if (profile) {
      await supabase
        .from("customer_profiles")
        .update({
          points_balance: Math.max(0, profile.points_balance - validatedPoints + pointsEarned),
          visit_count:    profile.visit_count + 1,
          total_spent:    profile.total_spent + finalDue,
          last_visit_at:  now.toISOString(),
        })
        .eq("phone", order.customer_phone);
    } else {
      await supabase.from("customer_profiles").insert({
        phone:          order.customer_phone,
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
