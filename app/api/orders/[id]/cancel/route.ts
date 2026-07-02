import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppSettings, computeRefund } from "@/lib/settings";
import { sendWhatsAppCancellation } from "@/lib/whatsapp";
import { err, ok } from "@/lib/validators/schemas";

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const admin = createAdminClient();

  let isEmergency = false;
  let isSilent = false;
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.emergency === true) isEmergency = true;
    // silent=true → skip WhatsApp notification (used when cancelling due to payment failure)
    if (body?.silent === true) isSilent = true;
  } catch {}

  try {
    // 1. Fetch Order and Location details
    const { data: order, error: orderError } = await admin
      .from("orders")
      .select(`
        id,
        status,
        advance_paid,
        discount_amount,
        points_redeemed,
        location_id,
        customer_name,
        customer_phone,
        created_at,
        locations (
          slug,
          timezone
        )
      `)
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json(err("Order not found", "NOT_FOUND"), { status: 404 });
    }

    if (order.status !== "open" && !isEmergency) {
      return NextResponse.json(
        err(`Order cannot be cancelled because its status is '${order.status}'`, "INVALID_STATE"),
        { status: 400 }
      );
    }

    // 2. Fetch active order items
    const { data: items, error: itemsError } = await admin
      .from("order_items")
      .select("id, scheduled_start, scheduled_end, actual_start, expected_end, actual_end, rate_per_hour, status")
      .eq("order_id", orderId)
      .eq("is_deleted", false);

    if (itemsError || !items || items.length === 0) {
      return NextResponse.json(err("No active booking slots found for this order", "INVALID_STATE"), { status: 400 });
    }

    const scheduledStarts = items
      .map((i) => i.scheduled_start)
      .filter(Boolean)
      .map((s) => new Date(s!).getTime());

    if (scheduledStarts.length === 0 && !isEmergency) {
      return NextResponse.json(err("This order does not contain scheduled bookings", "INVALID_STATE"), { status: 400 });
    }

    const earliestStartMs = scheduledStarts.length > 0 ? Math.min(...scheduledStarts) : Date.now();
    const nowMs = Date.now();

    if (nowMs >= earliestStartMs && !isEmergency) {
      return NextResponse.json(err("Booking has already started and cannot be cancelled", "INVALID_STATE"), { status: 400 });
    }

    // 3. Compute the refund amount based on cancellation policy settings
    const settings = await getAppSettings(admin);

    // Calculate total cost to determine if they paid in full
    const totalCost = items.reduce((sum, item) => {
      const startStr = item.scheduled_start || item.actual_start;
      const endStr = item.scheduled_end || item.expected_end || item.actual_end;
      if (!startStr || !endStr) return sum;

      const start = new Date(startStr);
      const end = new Date(endStr);
      const hrs = (end.getTime() - start.getTime()) / (3600 * 1000);
      const itemRate = Number(item.rate_per_hour) || 0;
      return sum + (itemRate * hrs);
    }, 0);

    const roundedTotalCost = Math.round(totalCost);
    const amountPaidVal = Number(order.advance_paid) || 0;
    const discountVal = Number(order.discount_amount) || 0;
    const pointsRedeemed = Number(order.points_redeemed) || 0;
    const pointsDiscountVal = pointsRedeemed * (settings.loyalty.redeem_rupees_per_point || 0);
    const totalDiscountVal = discountVal + pointsDiscountVal;
    const netCost = Math.max(0, roundedTotalCost - totalDiscountVal);
    const isFullyPaid = amountPaidVal >= netCost - 1;

    const policyTiers = isFullyPaid
      ? settings.booking.cancellation_full
      : settings.booking.cancellation_advance;

    const { refundAmount, matchedTier } = computeRefund(
      policyTiers,
      nowMs,
      earliestStartMs,
      amountPaidVal
    );

    const refundPct = matchedTier ? matchedTier.refund_pct : 0;

    // 4. Look up completed payment for this order
    const { data: paymentRow } = await admin
      .from("payments")
      .select("id, razorpay_payment_id, method")
      .eq("order_id", orderId)
      .eq("status", "completed")
      .maybeSingle();

    // 5. Trigger refund if amount > 0
    if (refundAmount > 0) {
      if (paymentRow?.razorpay_payment_id) {
        // Live Razorpay payment -> call Razorpay refund API
        const refundAmountPaise = Math.round(refundAmount * 100);
        const keyId = (process.env.RAZORPAY_KEY_ID || "").trim();
        const keySecret = (process.env.RAZORPAY_KEY_SECRET || "").trim();
        const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

        const targetUrl = `https://api.razorpay.com/v1/payments/${paymentRow.razorpay_payment_id}/refund`;
        const payload = { amount: refundAmountPaise };

        console.log(`[Cancellation API] Processing real Razorpay refund...`, {
          keyIdStart: keyId ? keyId.substring(0, 8) : "none",
          secretLength: keySecret.length,
          paymentId: paymentRow.razorpay_payment_id,
          targetUrl,
          payload
        });

        const rpRes = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${credentials}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!rpRes.ok) {
          const rpErrorText = await rpRes.text();
          console.error("[Cancellation API] Razorpay refund failed:", rpErrorText);
          let errorMsg = "Failed to process refund with payment processor";
          try {
            const parsedError = JSON.parse(rpErrorText);
            if (parsedError.error?.description) {
              errorMsg = `Razorpay: ${parsedError.error.description}`;
            }
          } catch {}
          return NextResponse.json(err(errorMsg, "REFUND_FAILED"), { status: 502 });
        }
      } else {
        // Offline / Manual / Free payment -> log the simulated refund
        console.log(`[Cancellation API] Simulating refund of ₹${refundAmount} for order ${orderId} (Offline/Manual payment)...`);
      }

      // Insert negative payment row to balance out accounts
      await admin.from("payments").insert({
        order_id: orderId,
        amount: -refundAmount,
        method: paymentRow?.method || "razorpay",
        status: "completed",
        collected_at: new Date().toISOString(),
      });
    }

    // 6. Update order, order items, and bookings status to cancelled
    await Promise.all([
      admin.from("orders").update({ status: "cancelled" }).eq("id", orderId),
      admin.from("order_items").update({ status: "cancelled" }).eq("order_id", orderId).eq("is_deleted", false),
      admin.from("bookings").update({ status: "cancelled" }).eq("order_id", orderId),
    ]);

    // 6.5. Restore redeemed points and revoke earned points on the customer profile
    if (order.customer_phone) {
      const pointsRedeemed = Number(order.points_redeemed) || 0;
      const pointsEarned = Math.floor(amountPaidVal / settings.loyalty.earn_rupees_per_point);

      if (pointsRedeemed > 0 || pointsEarned > 0) {
        const { data: profile } = await admin
          .from("customer_profiles")
          .select("points_balance")
          .eq("phone", order.customer_phone)
          .single();

        if (profile) {
          const newBalance = Math.max(0, profile.points_balance + pointsRedeemed - pointsEarned);
          await admin
            .from("customer_profiles")
            .update({ points_balance: newBalance })
            .eq("phone", order.customer_phone);
        }
      }
    }

    // 7. Trigger WhatsApp Cancellation Notification
    // Skip if: caller explicitly requested silence, OR no payment was ever made
    // (e.g. payment gateway failed before customer even saw checkout — no need to alarm them)
    const neverPaid = amountPaidVal === 0;
    if (!isSilent && !neverPaid) {
      await sendWhatsAppCancellation(orderId, refundPct, refundAmount);
    }

    return NextResponse.json(ok({ success: true, refundAmount, refundPct }));
  } catch (error) {
    console.error("[Cancellation API] Unexpected error:", error);
    return NextResponse.json(err("An unexpected server error occurred", "SERVER_ERROR"), { status: 500 });
  }
}
