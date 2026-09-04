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

  // Idempotency: if the order is already paid/confirmed, skip immediately
  if (order.status === "open" && order.advance_paid > 0) {
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

  const totalDiscount = Math.round((bill.discountAmount + bill.memberDiscountAmount + bill.freeHoursDiscountAmount) * 100) / 100;
  const netAdvancePaid = Math.max(0, bill.subtotal - totalDiscount);

  // Security Guard: If payment is required but payment_id was not provided
  if (netAdvancePaid > 0 && !body.payment_id) {
    return NextResponse.json(err("Payment ID is required for this booking", "PAYMENT_REQUIRED"), { status: 400 });
  }

  let paidAmount = 0;
  let paymentUpdatePromise: PromiseLike<any> = Promise.resolve();
  let loyaltyProfilePromise: PromiseLike<any> = Promise.resolve();
  let whatsappNotificationPromise: PromiseLike<any> = Promise.resolve();

  if (body.payment_id) {
    const creds = await getRazorpayCredentialsForOrder(admin, orderId);
    const keyId = creds.keyId;
    const keySecret = creds.keySecret;
    const credentials = btoa(`${keyId}:${keySecret}`);

    const rzpRes = await fetch(`https://api.razorpay.com/v1/payments/${body.payment_id}`, {
      headers: {
        "Authorization": `Basic ${credentials}`,
      },
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

    paidAmount = payment.amount / 100;

    // Update payment record
    paymentUpdatePromise = admin.from("payments").update({
      status: "completed",
      razorpay_payment_id: body.payment_id,
      collected_at: new Date().toISOString(),
    }).eq("id", dbPayment.id).then(() => {});

    // Update loyalty points
    if (order.customer_phone) {
      const phone = order.customer_phone;
      loyaltyProfilePromise = (async () => {
        const { getAppSettings } = await import("@/lib/settings");
        const settings = await getAppSettings(admin);
        const pointsEarned = Math.floor(paidAmount / settings.loyalty.earn_rupees_per_point);
        const netPoints    = pointsEarned - (order.points_redeemed ?? 0);

        const { data: profile } = await admin
          .from("customer_profiles")
          .select("points_balance")
          .eq("phone", phone)
          .single();

        if (profile) {
          await admin.from("customer_profiles").update({
            points_balance: Math.max(0, profile.points_balance + netPoints),
            last_visit_at:  new Date().toISOString(),
          }).eq("phone", phone);
        } else {
          await admin.from("customer_profiles").insert({
            phone:          phone,
            name:           order.customer_name,
            points_balance: Math.max(0, netPoints),
            visit_count:    0,
            total_spent:    0,
            last_visit_at:  new Date().toISOString(),
          });
        }
      })();
    }

    // WhatsApp notification will be handled below
  }

  const finalPaidAmount = body.payment_id ? paidAmount : netAdvancePaid;

  // Trigger WhatsApp notification for all confirmed bookings
  whatsappNotificationPromise = (async () => {
    const { sendWhatsAppConfirmation } = await import("@/lib/whatsapp");
    await sendWhatsAppConfirmation(orderId).catch((e) => console.error("WhatsApp failed:", e));
  })();

  const membershipUpdatePromises = Array.from(ledgerUpdates.values())
    .filter(e => e.hoursRedeemed > 0)
    .map(e =>
      admin.from("customer_memberships").update({
        free_hours_ledger: e.ledger,
        free_hrs_used: e.freeHrsUsed + e.hoursRedeemed,
      }).eq("id", e.id)
    );

  const primaryMembership = memberships.find(m => {
    const e = ledgerUpdates.get(m.id);
    return e && e.hoursRedeemed > 0;
  }) ?? memberships[0] ?? null;

  const { data: existingBookings } = await admin
    .from("bookings")
    .select("id")
    .eq("order_id", orderId);

  const bookingsPromise = (!existingBookings || existingBookings.length === 0) ? (async () => {
    const bookingsToInsert = (items ?? [])
      .filter((item) => item.scheduled_start && item.scheduled_end)
      .map((item) => ({
        order_id: orderId,
        order_item_id: item.id,
        scheduled_start: item.scheduled_start!,
        scheduled_end: item.scheduled_end!,
        held_until: new Date(new Date(item.scheduled_start!).getTime() + 15 * 60 * 1000).toISOString(),
        status: "confirmed" as const,
      }));
    if (bookingsToInsert.length > 0) {
      await admin.from("bookings").insert(bookingsToInsert);
    }
  })() : Promise.resolve();

  await Promise.all([
    admin
      .from("orders")
      .update({
        status: "open",
        subtotal: bill.subtotal,
        discount_amount: totalDiscount,
        public_discount_amount: (order as any).public_discount_amount ?? 0,
        total_amount: netAdvancePaid,
        points_redeemed_online: order.points_redeemed ?? 0,
        // Guard: only overwrite advance_paid if the Razorpay webhook hasn't already
        // written the real payment amount. Webhook fires async — if it won the race
        // first (advance_paid > 0 on the order), preserve that value.
        // For fully-free orders (free hours covering 100%), both values are 0 — safe.
        ...(order.advance_paid > 0
          ? {}
          : { advance_paid: finalPaidAmount }),
        amount_due: 0,
        membership_id: order.membership_id ?? primaryMembership?.id ?? null,
      })
      .eq("id", orderId),
    admin
      .from("order_items")
      .update({ status: "scheduled" })
      .eq("order_id", orderId)
      .eq("status", "cancelled"),
    bookingsPromise,
    paymentUpdatePromise,
    loyaltyProfilePromise,
    whatsappNotificationPromise,
    ...membershipUpdatePromises,
  ]);

  return NextResponse.json(ok({ order_id: orderId }));
}
