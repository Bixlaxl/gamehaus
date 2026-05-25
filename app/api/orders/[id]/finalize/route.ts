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

  // Fetch order, items, and extras in parallel — 3 round trips → 1
  const [
    { data: order, error: orderError },
    { data: items },
    { data: extras },
  ] = await Promise.all([
    admin.from("orders").select("*, coupon:coupons(*)").eq("id", orderId).single(),
    admin.from("order_items").select("*").eq("order_id", orderId).eq("is_deleted", false),
    admin.from("order_extras").select("*").eq("order_id", orderId).eq("is_deleted", false),
  ]);

  if (orderError || !order) {
    return NextResponse.json(err("Order not found", "NOT_FOUND"), { status: 404 });
  }
  if (order.status !== "open") {
    return NextResponse.json(err("Order is not open", "INVALID_STATE"), { status: 400 });
  }

  const activeItems = (items ?? []).filter((i) => i.status !== "cancelled");
  if (activeItems.some((i) => i.status === "running")) {
    return NextResponse.json(
      err("Stop all running sessions before finalizing", "SESSIONS_RUNNING"),
      { status: 400 }
    );
  }

  const effectivePhone = order.customer_phone ?? phoneOverride ?? null;
  let coupon: Coupon | null = order.coupon as Coupon | null;

  // Run optional coupon lookup and phone override save in parallel
  const [couponLookup] = await Promise.all([
    (!coupon && coupon_code)
      ? admin.from("coupons").select("*").eq("code", coupon_code.toUpperCase()).single()
      : Promise.resolve({ data: null, error: null }),
    (phoneOverride && !order.customer_phone)
      ? admin.from("orders").update({ customer_phone: phoneOverride }).eq("id", orderId)
      : Promise.resolve(null),
  ]);
  if (!coupon && coupon_code) coupon = couponLookup.data as Coupon | null;

  // Re-validate the coupon against ALL rules (active, dates, max_uses, location).
  // If invalid here we silently drop it — the customer isn't present to fix it
  // at this point and the staff shouldn't lose the bill over a stale coupon.
  if (coupon) {
    const nowMs        = Date.now();
    const expired      = coupon.valid_until && new Date(coupon.valid_until).getTime() < nowMs;
    const notYetActive = coupon.valid_from  && new Date(coupon.valid_from).getTime()  > nowMs;
    const overCap      = coupon.max_uses !== null && coupon.used_count >= coupon.max_uses;
    const wrongLoc     = coupon.location_id && coupon.location_id !== order.location_id;
    if (!coupon.is_active || expired || notYetActive || overCap || wrongLoc) {
      coupon = null;
    }
  }

  const now = new Date();
  const bill = calculateBill(
    activeItems as OrderItem[],
    (extras ?? []) as OrderExtra[],
    now,
    coupon,
    order.advance_paid
  );

  // Fetch membership and points balance in parallel if phone known
  const [membershipResult, pointsProfileResult] = await Promise.all([
    effectivePhone
      ? admin
          .from("customer_memberships")
          .select("*, plan:membership_plans(discount_pct)")
          .eq("customer_phone", effectivePhone)
          .eq("is_active", true)
          .gte("expires_at", now.toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    (points_redeemed > 0 && effectivePhone)
      ? admin.from("customer_profiles").select("points_balance").eq("phone", effectivePhone).single()
      : Promise.resolve({ data: null }),
  ]);

  // Apply membership discount (before points)
  const membershipRow = (membershipResult as { data: { plan: { discount_pct: number } | null } | null }).data;
  const membershipDiscountPct = membershipRow?.plan?.discount_pct ?? 0;
  const membershipDiscount    = membershipDiscountPct > 0
    ? Math.floor(bill.totalDue * membershipDiscountPct / 100)
    : 0;
  const billAfterMembership   = Math.max(0, bill.totalDue - membershipDiscount);

  // Validate points against remaining balance
  let validatedPoints = points_redeemed;
  if (validatedPoints > 0 && effectivePhone) {
    const balance = (pointsProfileResult as { data: { points_balance: number } | null }).data?.points_balance ?? 0;
    validatedPoints = Math.min(validatedPoints, balance, Math.floor(billAfterMembership));
  } else {
    validatedPoints = 0;
  }

  // Apply points discount on top of membership discount
  const finalDue = Math.max(0, Math.round((billAfterMembership - validatedPoints) * 100) / 100);
  const pointsEarned = Math.floor(finalDue / 100);

  // All four writes/reads are independent — run them in parallel (4 round trips → 1)
  const [
    { error: finalizeError },
    { error: paymentError },
    ,
    profileResult,
  ] = await Promise.all([
    admin
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
      .eq("id", orderId),
    admin.from("payments").insert({
      order_id:     orderId,
      amount:       finalDue,
      method:       payment_method,
      status:       "completed",
      collected_by: user.id,
      collected_at: now.toISOString(),
    }),
    coupon
      ? admin.from("coupons").update({ used_count: coupon.used_count + 1 }).eq("id", coupon.id)
      : Promise.resolve(null),
    effectivePhone
      ? admin.from("customer_profiles").select("points_balance, visit_count, total_spent").eq("phone", effectivePhone).single()
      : Promise.resolve(null),
  ]);

  if (finalizeError) {
    return NextResponse.json(err(finalizeError.message, "DB_ERROR"), { status: 500 });
  }
  if (paymentError) {
    return NextResponse.json(err(paymentError.message, "DB_ERROR"), { status: 500 });
  }

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
    total_due:           finalDue,
    points_redeemed:     validatedPoints,
    points_earned:       pointsEarned,
    membership_discount: membershipDiscount,
  }));
}
