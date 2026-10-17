import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateBill } from "@/lib/billing/engine";
import { ok, err } from "@/lib/validators/schemas";
import { getRazorpayCredentialsForOrder } from "@/lib/razorpay";
import type { OrderItem, OrderExtra } from "@/lib/supabase/types";

export const runtime = "edge";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const admin = createAdminClient();

  const body = await request.json().catch(() => ({})) as {
    coupon_code?: string;
    customer_phone?: string;
    payment_id?: string;
  };

  // Fetch order, items, and extras in parallel
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

  // Idempotency: if the order is already confirmed (booking exists or advance_paid > 0), skip
  const { data: existingBookingsEarly } = await admin
    .from("bookings")
    .select("id")
    .eq("order_id", orderId)
    .limit(1);

  if ((order.status === "open" && order.advance_paid > 0) || (existingBookingsEarly && existingBookingsEarly.length > 0)) {
    return NextResponse.json(ok({ order_id: orderId }));
  }

  const effectivePhone = body.customer_phone || order.customer_phone;
  const now = new Date();

  // Fetch active memberships for customer
  const { data: allMemberships } = await (effectivePhone
    ? admin
        .from("customer_memberships")
        .select("*, plan:membership_plans(*)")
        .eq("customer_phone", effectivePhone)
        .eq("is_active", true)
        .gte("expires_at", now.toISOString())
        .order("created_at", { ascending: false })
    : Promise.resolve({ data: [] }));

  const memberships: any[] = allMemberships ?? [];
  const membershipDiscountPct = memberships.reduce((max, m) => {
    const pct = m.plan?.discount_pct ?? 0;
    return pct > max ? pct : max;
  }, 0);

  const ledgerUpdates: Map<string, { id: string; ledger: Record<string, number>; hoursRedeemed: number; freeHrsUsed: number }> = new Map();
  memberships.forEach(m => {
    const planFreeHrs = Number(m.plan?.free_hrs || 0);
    const ledger: Record<string, number> = { ...(m.free_hours_ledger as Record<string, number> || {}) };
    if (planFreeHrs > 0 && Object.keys(ledger).length === 0) {
      ["snooker", "pool", "ps5", "foosball", "simulator", "standard"].forEach((t) => {
        ledger[t] = planFreeHrs;
      });
    }
    ledgerUpdates.set(m.id, {
      id: m.id,
      ledger,
      hoursRedeemed: 0,
      freeHrsUsed: Number(m.free_hrs_used || 0),
    });
  });

  let totalFreeHoursDiscount = 0;
  const activeItems = (items ?? []).filter((i) => i.status !== "cancelled");

  for (const item of activeItems) {
    const table = (item as any).table;
    if (!table) continue;

    const itemMembershipId = (item as any).membership_id;
    const isBound = (m: any) => !m.bound_table_ids || m.bound_table_ids.length === 0 || m.bound_table_ids.includes(table.id);
    let coveringMembership = itemMembershipId
      ? memberships.find(m => m.id === itemMembershipId && isBound(m))
      : memberships.find(m => isBound(m));

    if (!coveringMembership) continue;

    const ledgerEntry = ledgerUpdates.get(coveringMembership.id)!;
    const tableType = table.type || "";
    const remainingFreeHrs = Number(ledgerEntry.ledger[tableType]) || 0;
    if (remainingFreeHrs <= 0) continue;

    let durationHrs = 0;
    if (item.scheduled_start && item.scheduled_end) {
      durationHrs = (new Date(item.scheduled_end).getTime() - new Date(item.scheduled_start).getTime()) / (3600 * 1000);
    } else if (item.scheduled_duration_mins) {
      durationHrs = item.scheduled_duration_mins / 60;
    }

    let maxRedeem = Math.min(durationHrs, remainingFreeHrs);
    if (typeof item.free_hours_to_redeem === "number" && item.free_hours_to_redeem >= 0) {
      maxRedeem = Math.min(maxRedeem, item.free_hours_to_redeem);
    }

    const freeHoursDiscount = maxRedeem * (item.rate_per_hour || 0);
    totalFreeHoursDiscount += freeHoursDiscount;
    ledgerEntry.hoursRedeemed += maxRedeem;
    ledgerEntry.ledger[tableType] = Math.max(0, Math.round((remainingFreeHrs - maxRedeem) * 100) / 100);
  }

  const bill = calculateBill(
    activeItems as OrderItem[],
    (extras ?? []) as OrderExtra[],
    now,
    order.coupon,
    0,
    order.discount_amount ?? 0,
    membershipDiscountPct,
    totalFreeHoursDiscount
  );

  const { getAppSettings } = await import("@/lib/settings");
  const settings = await getAppSettings(admin);
  const redeemRate = settings.loyalty.redeem_rupees_per_point ?? 1;
  const pointsDiscount = (order.points_redeemed ?? 0) * redeemRate;

  const totalDiscount = Math.round((bill.discountAmount + bill.memberDiscountAmount + bill.freeHoursDiscountAmount) * 100) / 100;
  const netAdvancePaid = Math.max(0, Math.round((bill.subtotal - totalDiscount - pointsDiscount) * 100) / 100);

  // Security Guard: If payment is required but payment_id was not provided
  if (netAdvancePaid > 0 && !body.payment_id) {
    return NextResponse.json(err("Payment ID is required for this booking", "PAYMENT_REQUIRED"), { status: 400 });
  }

  let paidAmount = 0;

  // ── Verify payment with Razorpay ─────────────────────────────────────────
  if (body.payment_id) {
    const creds = await getRazorpayCredentialsForOrder(admin, orderId);
    const credentials = btoa(`${creds.keyId}:${creds.keySecret}`);

    const rzpRes = await fetch(`https://api.razorpay.com/v1/payments/${body.payment_id}`, {
      headers: { "Authorization": `Basic ${credentials}` },
    });
    if (!rzpRes.ok) {
      const errTxt = await rzpRes.text();
      console.error("[Razorpay Payment Verification Failed]", errTxt);
      return NextResponse.json(err("Failed to verify payment with Razorpay", "PAYMENT_VERIFICATION_ERROR"), { status: 400 });
    }
    const payment = await rzpRes.json() as { id: string; order_id: string; amount: number; status: string };

    const { data: dbPayment, error: dbPayErr } = await admin
      .from("payments")
      .select("id, razorpay_order_id, status")
      .eq("order_id", orderId)
      .single();

    if (dbPayErr || !dbPayment) {
      return NextResponse.json(err("Payment record not found for this order", "PAYMENT_NOT_FOUND"), { status: 400 });
    }

    if (dbPayment.razorpay_order_id !== payment.order_id) {
      return NextResponse.json(err("Payment record order ID mismatch", "PAYMENT_MISMATCH"), { status: 400 });
    }

    if (payment.status !== "captured" && payment.status !== "authorized") {
      return NextResponse.json(err("Payment is incomplete or failed", "PAYMENT_INCOMPLETE"), { status: 400 });
    }

    paidAmount = payment.amount / 100; // Convert paise → rupees
  }

  const finalPaidAmount = body.payment_id ? paidAmount : netAdvancePaid;

  // ── Delegate to the atomic RPC ────────────────────────────────────────────
  // The RPC handles: payment claim (idempotent), advance_paid accumulation,
  // booking insertion (ON CONFLICT DO NOTHING), coupon used_count, loyalty points.
  const { data: rpcResult, error: rpcError } = await (admin as any)
    .rpc("confirm_order_payment", {
      p_order_id:             orderId,
      p_razorpay_order_id:    body.payment_id
        ? (await admin.from("payments").select("razorpay_order_id").eq("order_id", orderId).single()).data?.razorpay_order_id
        : null,
      p_razorpay_payment_id:  body.payment_id ?? null,
      p_verified_amount:      finalPaidAmount,
      p_method:               "razorpay",
    });

  if (rpcError) {
    console.error(`[confirm-online] confirm_order_payment RPC error for order ${orderId}:`, rpcError);
    return NextResponse.json(err("Failed to confirm payment", "INTERNAL_ERROR"), { status: 500 });
  }

  const result = rpcResult as {
    success: boolean;
    already_processed?: boolean;
    error?: string;
  };

  if (!result.success) {
    const code = result.error ?? "CONFIRM_FAILED";
    return NextResponse.json(err("Could not confirm payment", code), { status: 409 });
  }

  // ── Update order financial summary columns ─────────────────────────────────
  // These are display/reporting columns; the RPC already set status + advance_paid.
  // Only update if the webhook hasn't already written them (advance_paid guard).
  await admin
    .from("orders")
    .update({
      subtotal:              bill.subtotal,
      discount_amount:       totalDiscount,
      public_discount_amount: (order as any).public_discount_amount ?? 0,
      total_amount:          netAdvancePaid,
      points_redeemed_online: order.points_redeemed ?? 0,
      amount_due:            0,
      membership_id:         order.membership_id ?? null,
    })
    .eq("id", orderId);

  // ── Decrement membership free-hours ledger ─────────────────────────────────
  const membershipUpdatePromises = Array.from(ledgerUpdates.values())
    .filter(e => e.hoursRedeemed > 0)
    .map(e =>
      admin.from("customer_memberships").update({
        free_hours_ledger: e.ledger,
        free_hrs_used: e.freeHrsUsed + e.hoursRedeemed,
      }).eq("id", e.id)
    );

  if (membershipUpdatePromises.length > 0) {
    await Promise.all(membershipUpdatePromises);
  }

  // ── Dispatch WhatsApp confirmation (non-fatal) ─────────────────────────────
  const { sendWhatsAppConfirmation } = await import("@/lib/whatsapp");
  sendWhatsAppConfirmation(orderId).catch((e) =>
    console.error("[confirm-online] WhatsApp failed:", e)
  );

  return NextResponse.json(ok({ order_id: orderId }));
}
