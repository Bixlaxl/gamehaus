import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";
import { calculateBill } from "@/lib/billing/engine";
import { getAppSettings } from "@/lib/settings";
import { z } from "zod";
import type { OrderItem, OrderExtra, Coupon } from "@/lib/supabase/types";

export const runtime = 'edge';


// Each split is one row in the `payments` table. Sum must equal finalDue.
// Single-method payment is just an array of length 1 — the modal sends it that
// way so the API has one code path.
const paymentSplit = z.object({
  method: z.enum(["cash", "upi"]),
  amount: z.number().nonnegative(),
});

const schema = z.object({
  payments:        z.array(paymentSplit).min(0).max(4),
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

  const { payments, coupon_code, points_redeemed, customer_phone: phoneOverride } = parsed.data;
  const admin = createAdminClient();

  // Fetch order, items, and extras in parallel — 3 round trips → 1
  const [
    { data: order, error: orderError },
    { data: items },
    { data: extras },
  ] = await Promise.all([
    admin.from("orders").select("*, coupon:coupons(*)").eq("id", orderId).single(),
    admin.from("order_items").select("*, table:tables(*)").eq("order_id", orderId).eq("is_deleted", false),
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

  // Fetch ALL active memberships for this customer + points balance in parallel
  const [allMembershipsResult, pointsProfileResult] = await Promise.all([
    effectivePhone
      ? admin
          .from("customer_memberships")
          .select("*, plan:membership_plans(*)")
          .eq("customer_phone", effectivePhone)
          .eq("is_active", true)
          .gte("expires_at", now.toISOString())
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    (points_redeemed > 0 && effectivePhone)
      ? admin.from("customer_profiles").select("points_balance").eq("phone", effectivePhone).single()
      : Promise.resolve({ data: null }),
  ]);

  const allMemberships: any[] = (allMembershipsResult as { data: any[] | null }).data ?? [];

  // Highest global discount pct across ALL active membership plans
  const membershipDiscountPct = allMemberships.reduce((max, m) => {
    const pct = m.plan?.discount_pct ?? 0;
    return pct > max ? pct : max;
  }, 0);

  // Track per-membership ledger updates and hours used
  const ledgerUpdates: Map<string, { id: string; ledger: Record<string, number>; hoursRedeemed: number; freeHrsUsed: number }> = new Map();
  allMemberships.forEach(m => {
    ledgerUpdates.set(m.id, {
      id: m.id,
      ledger: { ...(m.free_hours_ledger as Record<string, number> || {}) },
      hoursRedeemed: 0,
      freeHrsUsed: Number(m.free_hrs_used || 0),
    });
  });

  let totalFreeHoursDiscount = 0;

  // For each active item, find which membership covers it (via item.membership_id or bound_table_ids)
  for (const item of activeItems) {
    const table = (item as any).table;
    if (!table) continue;

    // Find the membership that covers this item — prefer the one explicitly linked, then fall back to any bound membership
    const itemMembershipId = (item as any).membership_id;
    let coveringMembership = itemMembershipId
      ? allMemberships.find(m => m.id === itemMembershipId)
      : allMemberships.find(m => m.bound_table_ids?.includes(table.id));

    if (!coveringMembership) continue;

    const ledgerEntry = ledgerUpdates.get(coveringMembership.id)!;
    const tableType = table.type || "";
    const remainingFreeHrs = Number(ledgerEntry.ledger[tableType]) || 0;
    if (remainingFreeHrs <= 0) continue;

    let start: Date;
    let end: Date;
    if (item.actual_start) {
      start = new Date(item.actual_start);
      end = item.expected_end
        ? new Date(item.expected_end)
        : item.actual_end
        ? new Date(item.actual_end)
        : now;
    } else if (item.scheduled_start && item.scheduled_end) {
      start = new Date(item.scheduled_start);
      end = new Date(item.scheduled_end);
    } else {
      continue;
    }

    const durationHrs = (end.getTime() - start.getTime()) / (3600 * 1000);
    let maxRedeem = Math.min(durationHrs, remainingFreeHrs);
    if (typeof item.free_hours_to_redeem === "number" && item.free_hours_to_redeem >= 0) {
      maxRedeem = Math.min(maxRedeem, item.free_hours_to_redeem);
    }

    const freeHoursDiscount = maxRedeem * (item.rate_per_hour || 0);
    totalFreeHoursDiscount += freeHoursDiscount;
    ledgerEntry.hoursRedeemed += maxRedeem;
    ledgerEntry.ledger[tableType] = Math.max(0, Math.round((remainingFreeHrs - maxRedeem) * 100) / 100);
  }

  // Calculate net session due (table lines only) for applying the % discount on top
  const sessionTotal = bill.tableLines.reduce((sum, l) => sum + l.amount, 0);
  const scheduledSubtotal = bill.tableLines.reduce((sum, l) => sum + l.scheduledAmount, 0);
  const overtimeTotal = Math.max(0, sessionTotal - scheduledSubtotal);
  const netSessionDue = bill.advancePaid > 0
    ? Math.max(0, scheduledSubtotal - bill.advancePaid) + overtimeTotal
    : sessionTotal;

  const remainingSessionDue = Math.max(0, netSessionDue - totalFreeHoursDiscount);
  const pctDiscount = membershipDiscountPct > 0
    ? Math.floor(remainingSessionDue * membershipDiscountPct / 100)
    : 0;

  let membershipDiscount = Math.round((totalFreeHoursDiscount + pctDiscount) * 100) / 100;
  membershipDiscount = Math.min(membershipDiscount, bill.totalDue);

  const billAfterMembership = Math.max(0, Math.round((bill.totalDue - membershipDiscount) * 100) / 100);

  // Load owner-configured loyalty rates (falls back to defaults if unset)
  const settings = await getAppSettings(admin);
  const earnRate   = settings.loyalty.earn_rupees_per_point;
  const redeemRate = settings.loyalty.redeem_rupees_per_point;

  // Validate points against remaining balance — cap so redemption can't push
  // the bill below zero or exceed the customer's actual balance.
  // Minimum redemption is 100 points — anything below is treated as zero.
  let validatedPoints = points_redeemed;
  if (validatedPoints > 0 && validatedPoints < 100) {
    validatedPoints = 0;
  }
  if (validatedPoints > 0 && effectivePhone) {
    const balance = (pointsProfileResult as { data: { points_balance: number } | null }).data?.points_balance ?? 0;
    const maxByBill = Math.floor(billAfterMembership / redeemRate);
    validatedPoints = Math.min(validatedPoints, balance, maxByBill);
  } else {
    validatedPoints = 0;
  }

  // Apply points discount: each point is worth `redeemRate` rupees off the bill.
  const pointsDiscount = validatedPoints * redeemRate;
  const finalDue = Math.max(0, Math.round((billAfterMembership - pointsDiscount) * 100) / 100);
  const pointsEarned = Math.floor(finalDue / earnRate);

  // Validate split total: sum of payment amounts must equal finalDue, within
  // ₹1 to absorb minor rounding (the modal rounds amounts to whole rupees).
  const paymentTotal = Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  if (Math.abs(paymentTotal - finalDue) > 1) {
    return NextResponse.json(
      err(`Payment total ₹${paymentTotal} does not match bill ₹${finalDue}`, "PAYMENT_MISMATCH"),
      { status: 400 }
    );
  }

  const toInsert = payments
    .filter((p) => p.amount > 0)
    .map((p) => ({
      order_id:     orderId,
      amount:       Math.round(p.amount * 100) / 100,
      method:       p.method,
      status:       "completed" as const,
      collected_by: user.id,
      collected_at: now.toISOString(),
    }));

  const paymentInsertPromise = toInsert.length > 0
    ? admin.from("payments").insert(toInsert)
    : Promise.resolve({ error: null });

  // Primary membership for order record (the one that gave the most free hours, or first)
  const primaryMembership = allMemberships.find(m => {
    const e = ledgerUpdates.get(m.id);
    return e && e.hoursRedeemed > 0;
  }) ?? allMemberships[0] ?? null;

  // Write order finalization + payments + coupon + all membership ledger updates + customer profile fetch in parallel
  const membershipUpdatePromises = Array.from(ledgerUpdates.values())
    .filter(e => e.hoursRedeemed > 0)
    .map(e =>
      admin.from("customer_memberships").update({
        free_hours_ledger: e.ledger,
        free_hrs_used: e.freeHrsUsed + e.hoursRedeemed,
      }).eq("id", e.id)
    );

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
        discount_amount: bill.discountAmount + membershipDiscount,
        total_amount:    bill.subtotal - (bill.discountAmount + membershipDiscount),
        amount_due:      finalDue,
        points_redeemed: validatedPoints,
        finalized_at:    now.toISOString(),
        coupon_id:       coupon?.id ?? order.coupon_id,
        membership_id:   order.membership_id ?? primaryMembership?.id ?? null,
      })
      .eq("id", orderId),
    paymentInsertPromise,
    coupon
      ? admin.from("coupons").update({ used_count: coupon.used_count + 1 }).eq("id", coupon.id)
      : Promise.resolve(null),
    effectivePhone
      ? admin.from("customer_profiles").select("points_balance, visit_count, total_spent").eq("phone", effectivePhone).single()
      : Promise.resolve(null),
    ...membershipUpdatePromises,
  ] as const);

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

