import { NextResponse } from "next/server";
import { z } from "zod";
import { ok, err } from "@/lib/validators/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRazorpayCredentialsForOrder } from "@/lib/razorpay";

import { isWeekendOperatingSlot } from "@/lib/operating-hours";

export const runtime = 'nodejs';

const schema = z.object({
  amount: z.number().positive(), // in paise
  currency: z.string().default("INR"),
  receipt: z.string(),
  order_id: z.string().uuid(),
  payment_mode: z.enum(["advance", "full"]).optional(),
});

export async function POST(request: Request) {
  const body: unknown = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { amount, currency, receipt, order_id, payment_mode } = parsed.data;
  const admin = createAdminClient();
  const creds = await getRazorpayCredentialsForOrder(admin, order_id);

  // Single Source of Truth: Fetch exact backend total_amount from database
  const { data: dbOrder } = await admin
    .from("orders")
    .select("total_amount, advance_paid, points_redeemed, points_redeemed_online, subtotal, discount_amount, location_id, type")
    .eq("id", order_id)
    .maybeSingle();

  let resolvedAmountInRupees: number;
  if (dbOrder?.total_amount !== null && dbOrder?.total_amount !== undefined) {
    const rawTotal = Number(dbOrder.total_amount) || 0;
    const advance = Number(dbOrder.advance_paid) || 0;

    // Safety fallback: If points were redeemed on an order where total_amount was saved without points deduction
    const pointsRedeemed = Number(dbOrder.points_redeemed_online || dbOrder.points_redeemed) || 0;
    const subtotal = Number(dbOrder.subtotal) || 0;
    const discount = Number(dbOrder.discount_amount) || 0;
    const pointsWereNotDeducted = pointsRedeemed > 0 && Math.abs(rawTotal - (subtotal - discount)) < 0.01;

    let fullAmountDue: number;
    if (pointsWereNotDeducted) {
      const { getAppSettings } = await import("@/lib/settings");
      const settings = await getAppSettings(admin);
      const redeemRate = settings.loyalty.redeem_rupees_per_point ?? 1;
      const pointsDiscount = pointsRedeemed * redeemRate;
      fullAmountDue = Math.max(0, rawTotal - pointsDiscount - advance);
    } else {
      fullAmountDue = Math.max(0, rawTotal - advance);
    }

    if (payment_mode === "advance") {
      // 1. Fetch location operating hours & timezone
      const { data: location } = await admin
        .from("locations")
        .select("opening_time, timezone")
        .eq("id", dbOrder.location_id)
        .maybeSingle();

      // 2. Fetch order items to inspect tables and scheduled slots
      const { data: orderItems } = await admin
        .from("order_items")
        .select("table_id, scheduled_start")
        .eq("order_id", order_id)
        .eq("is_deleted", false);

      const itemsList = orderItems || [];
      const isWeekend = itemsList.some(item =>
        item.scheduled_start && isWeekendOperatingSlot(item.scheduled_start, location?.opening_time, location?.timezone)
      );
      if (isWeekend) {
        return NextResponse.json(
          err("Advance booking is not available on weekends. Full payment is required.", "ADVANCE_NOT_ALLOWED_WEEKENDS"),
          { status: 400 }
        );
      }

      const uniqueTableCount = new Set(itemsList.map(item => item.table_id)).size || 1;
      const { getAppSettings } = await import("@/lib/settings");
      const settings = await getAppSettings(admin);
      const advancePerTable = settings.booking?.advance_amount_per_table ?? 100;
      const expectedAdvance = advancePerTable * uniqueTableCount;

      resolvedAmountInRupees = Math.min(expectedAdvance, fullAmountDue);
    } else {
      resolvedAmountInRupees = fullAmountDue;
    }
  } else {
    resolvedAmountInRupees = amount / 100;
  }

  const finalAmountInPaise = Math.round(resolvedAmountInRupees * 100);

  let rpOrder: { id: string; amount: number };
  try {
    const keyId = creds.keyId;
    const keySecret = creds.keySecret;
    const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ amount: finalAmountInPaise, currency, receipt, notes: { order_id } }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error("[Razorpay HTTP Response Failure]", {
        status: res.status,
        statusText: res.statusText,
        body: errBody
      });
      throw new Error(`Razorpay returned ${res.status}: ${errBody}`);
    }
    rpOrder = await res.json() as { id: string; amount: number };
  } catch (e) {
    console.error("[Create Order API Error]", e);
    console.log("[Create Order Debug Info]", {
      hasKeyId: !!creds.keyId,
      keyIdStart: creds.keyId ? creds.keyId.substring(0, 8) : "none",
      hasKeySecret: !!creds.keySecret,
      secretLength: creds.keySecret ? creds.keySecret.length : 0,
    });
    const msg = e instanceof Error ? e.message : "Razorpay error";
    return NextResponse.json(err(msg, "RAZORPAY_ERROR"), { status: 502 });
  }

  await admin.from("payments").insert({
    order_id,
    amount: finalAmountInPaise / 100,
    method: "razorpay",
    razorpay_order_id: rpOrder.id,
    status: "pending",
  });

  return NextResponse.json(ok({ razorpay_order_id: rpOrder.id, amount: rpOrder.amount, key_id: creds.keyId }));
}
