import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppSettings } from "@/lib/settings";
import { sendWhatsAppConfirmation, sendWhatsAppCancellation } from "@/lib/whatsapp";
import { getRazorpayCredentialsForOrder } from "@/lib/razorpay";

export const runtime = 'edge';

async function verifyHmac(secret: string, body: string, signature: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === signature;
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const secrets = [
    (process.env.RAZORPAY_WEBHOOK_SECRET || "").trim(),
    (process.env.NERFTURF_RAZORPAY_WEBHOOK_SECRET || "").trim(),
  ].filter(Boolean);

  let verified = false;
  for (const s of secrets) {
    if (await verifyHmac(s, body, signature)) {
      verified = true;
      break;
    }
  }

  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(body) as {
    event: string;
    payload: {
      payment: {
        entity: {
          id: string;
          order_id: string; // Razorpay order ID
          amount: number;   // in paise
          status: string;
        };
      };
    };
  };

  if (event.event === "payment.captured" || event.event === "order.paid") {
    const payment = event.payload.payment?.entity;
    if (!payment) return NextResponse.json({ received: true });
    const admin = createAdminClient();

    // ── Handle booking payments ──────────────────────────────────────────────
    const { data: paymentRow } = await admin
      .from("payments")
      .select("id, order_id, amount, status, method")
      .eq("razorpay_order_id", payment.order_id)
      .maybeSingle();

    if (paymentRow) {
      const now = new Date().toISOString();
      const orderId = paymentRow.order_id;

      // ── 1. Strict Webhook Idempotency Lock ──────────────────────────────────
      // Atomically transition status from pending to completed.
      // If a concurrent delivery or client confirm-online already updated this row,
      // updatedPayment is null and we exit idempotently without duplicate processing.
      const { data: updatedPayment } = await admin
        .from("payments")
        .update({
          status: "completed",
          razorpay_payment_id: payment.id,
          collected_at: now,
        })
        .eq("id", paymentRow.id)
        .neq("status", "completed")
        .select("id, order_id, amount, status")
        .maybeSingle();

      if (!updatedPayment) {
        console.log(`[Webhook] Payment ${paymentRow.id} already completed or concurrently claimed. Skipping.`);
        return NextResponse.json({ received: true });
      }

      // ── 2. Fetch Parent Order ──────────────────────────────────────────────
      const { data: order } = await admin
        .from("orders")
        .select("id, customer_phone, customer_name, points_redeemed, status, location_id")
        .eq("id", orderId)
        .single();

      if (!order) {
        console.error(`[Webhook] Order ${orderId} not found for payment ${paymentRow.id}`);
        return NextResponse.json({ received: true });
      }

      // ── 3. Branch: Normal On-Time Payment (Order Not Cancelled) ─────────────
      if (order.status !== "cancelled") {
        const { data: existingBookings } = await admin
          .from("bookings")
          .select("id")
          .eq("order_id", orderId);

        const bookingsPromise = (async () => {
          if (!existingBookings || existingBookings.length === 0) {
            const { data: items } = await admin
              .from("order_items")
              .select("id, scheduled_start, scheduled_end")
              .eq("order_id", orderId)
              .eq("is_deleted", false);

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
          } else {
            await admin.from("bookings").update({ status: "confirmed" }).eq("order_id", orderId);
          }
        })();

        await Promise.all([
          admin.from("orders").update({
            status: "open",
            advance_paid: paymentRow.amount,
            points_redeemed_online: order.points_redeemed ?? 0,
          }).eq("id", orderId),
          admin.from("order_items").update({ status: "scheduled" }).eq("order_id", orderId).eq("status", "cancelled"),
          bookingsPromise,
        ]);

        if (order.customer_phone) {
          const settings = await getAppSettings(admin);
          const pointsEarned = Math.floor(paymentRow.amount / settings.loyalty.earn_rupees_per_point);
          const netPoints = pointsEarned - (order.points_redeemed ?? 0);

          const { data: profile } = await admin
            .from("customer_profiles")
            .select("points_balance, visit_count, total_spent")
            .eq("phone", order.customer_phone)
            .single();

          if (profile) {
            await admin.from("customer_profiles").update({
              points_balance: Math.max(0, profile.points_balance + netPoints),
              last_visit_at: now,
            }).eq("phone", order.customer_phone);
          } else {
            await admin.from("customer_profiles").insert({
              phone: order.customer_phone,
              name: order.customer_name,
              points_balance: Math.max(0, netPoints),
              visit_count: 0,
              total_spent: 0,
              last_visit_at: now,
            });
          }
        }

        await sendWhatsAppConfirmation(orderId);
        return NextResponse.json({ received: true });
      }

      // ── 4. Branch: Late Payment on Cancelled Order (Self-Healing Path) ────────
      console.warn(`[Webhook] Order ${orderId} was cancelled before payment landed. Initiating atomic revival & conflict check.`);

      // 4A. Atomic revival: only one concurrent thread can transition this order from cancelled to open
      const { data: revivedOrder } = await admin
        .from("orders")
        .update({
          status: "open",
          advance_paid: paymentRow.amount,
          points_redeemed_online: order.points_redeemed ?? 0,
        })
        .eq("id", orderId)
        .eq("status", "cancelled")
        .select("id, status")
        .maybeSingle();

      if (!revivedOrder) {
        console.log(`[Webhook] Order ${orderId} revival conditional update yielded 0 rows (already revived or updated). Exiting.`);
        return NextResponse.json({ received: true });
      }

      // 4B. Check if the table slot is still free or was claimed by another customer
      const { data: orderItems } = await admin
        .from("order_items")
        .select("id, table_id, scheduled_start, scheduled_end")
        .eq("order_id", orderId)
        .eq("is_deleted", false);

      let slotConflict = false;

      if (orderItems && orderItems.length > 0) {
        for (const item of orderItems) {
          if (!item.table_id || !item.scheduled_start || !item.scheduled_end) continue;

          // Check if any other order has a confirmed/checked_in booking overlapping this window
          const { data: conflictingBookings } = await admin
            .from("bookings")
            .select("id, order_item:order_items!inner(table_id)")
            .eq("order_items.table_id", item.table_id)
            .neq("order_id", orderId)
            .in("status", ["confirmed", "checked_in"])
            .lt("scheduled_start", item.scheduled_end)
            .gt("scheduled_end", item.scheduled_start);

          if (conflictingBookings && conflictingBookings.length > 0) {
            slotConflict = true;
            break;
          }

          // Check if another active order_item is running or scheduled on this table
          const { data: conflictingItems } = await admin
            .from("order_items")
            .select("id, order:orders(id, status, type, advance_paid, created_by, created_at)")
            .eq("table_id", item.table_id)
            .eq("is_deleted", false)
            .neq("order_id", orderId)
            .in("status", ["running", "scheduled"])
            .lt("scheduled_start", item.scheduled_end)
            .gt("scheduled_end", item.scheduled_start);

          const sevenMinsAgoMs = Date.now() - 7 * 60 * 1000;
          const activeConflicts = (conflictingItems ?? []).filter((ci: any) => {
            const parent = ci.order;
            if (!parent) return false;
            if (["cancelled", "finalized", "completed", "closed"].includes(parent.status)) return false;
            const isUnpaidGuestDraft = parent.type === "online" && !parent.created_by && (parent.advance_paid ?? 0) === 0;
            if (isUnpaidGuestDraft) {
              const createdMs = new Date(parent.created_at ?? 0).getTime();
              if (createdMs < sevenMinsAgoMs) return false;
            }
            return true;
          });

          if (activeConflicts.length > 0) {
            slotConflict = true;
            break;
          }
        }
      }

      // 4C. Case: Slot is FREE -> Complete revival and confirm booking
      if (!slotConflict) {
        console.log(`[Webhook] Slot is still free! Successfully reviving order ${orderId} into confirmed booking.`);

        const bookingsToInsert = (orderItems ?? [])
          .filter((item) => item.scheduled_start && item.scheduled_end)
          .map((item) => ({
            order_id: orderId,
            order_item_id: item.id,
            scheduled_start: item.scheduled_start!,
            scheduled_end: item.scheduled_end!,
            held_until: new Date(new Date(item.scheduled_start!).getTime() + 15 * 60 * 1000).toISOString(),
            status: "confirmed" as const,
          }));

        await admin.from("bookings").delete().eq("order_id", orderId);
        if (bookingsToInsert.length > 0) {
          await admin.from("bookings").insert(bookingsToInsert);
        }
        await admin.from("order_items").update({ status: "scheduled" }).eq("order_id", orderId);

        if (order.customer_phone) {
          const settings = await getAppSettings(admin);
          const pointsEarned = Math.floor(paymentRow.amount / settings.loyalty.earn_rupees_per_point);
          const netPoints = pointsEarned - (order.points_redeemed ?? 0);

          const { data: profile } = await admin
            .from("customer_profiles")
            .select("points_balance, visit_count, total_spent")
            .eq("phone", order.customer_phone)
            .single();

          if (profile) {
            await admin.from("customer_profiles").update({
              points_balance: Math.max(0, profile.points_balance + netPoints),
              last_visit_at: now,
            }).eq("phone", order.customer_phone);
          } else {
            await admin.from("customer_profiles").insert({
              phone: order.customer_phone,
              name: order.customer_name,
              points_balance: Math.max(0, netPoints),
              visit_count: 0,
              total_spent: 0,
              last_visit_at: now,
            });
          }
        }

        await sendWhatsAppConfirmation(orderId);
        return NextResponse.json({ received: true });
      }

      // 4D. Case: Slot is TAKEN -> Automatic Refund Pipeline
      console.warn(`[Webhook] Slot conflict detected for order ${orderId}. Reverting order to cancelled and initiating auto-refund.`);

      await admin.from("orders").update({
        status: "cancelled",
        advance_paid: 0,
        amount_due: 0,
      }).eq("id", orderId);

      let refundSuccess = false;
      let refundId = "";

      try {
        const creds = await getRazorpayCredentialsForOrder(admin, orderId);
        const keyId = creds.keyId;
        const keySecret = creds.keySecret;
        const basicAuth = typeof btoa === "function"
          ? btoa(`${keyId}:${keySecret}`)
          : Buffer.from(`${keyId}:${keySecret}`).toString("base64");

        const refundRes = await fetch(`https://api.razorpay.com/v1/payments/${payment.id}/refund`, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${basicAuth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: payment.amount, // in paise
            notes: {
              reason: "Slot conflict after checkout timeout",
              order_id: orderId,
            },
          }),
        });

        if (refundRes.ok) {
          const refundJson = await refundRes.json() as { id?: string };
          refundId = refundJson?.id || "";
          refundSuccess = true;
          console.log(`[Webhook] Auto-refund successful for order ${orderId}. Refund ID: ${refundId}`);

          await admin.from("payments").insert({
            order_id: orderId,
            amount: -paymentRow.amount,
            method: (paymentRow.method as any) || "razorpay",
            status: "refunded",
            razorpay_payment_id: refundId,
            collected_at: now,
          });

          await admin.from("orders").update({
            status: "cancelled",
            advance_paid: 0,
            amount_due: 0,
          }).eq("id", orderId);

          await sendWhatsAppCancellation(orderId, 100, paymentRow.amount);
        } else {
          const errText = await refundRes.text();
          console.error(`[CRITICAL_REFUND_FAILURE] Razorpay refund API rejected refund for order ${orderId}, payment ${payment.id}:`, errText);
        }
      } catch (refundErr) {
        console.error(`[CRITICAL_REFUND_FAILURE] Exception calling Razorpay refund API for order ${orderId}:`, refundErr);
      }

      if (!refundSuccess) {
        console.error(`[CRITICAL_REFUND_FAILURE] Late payment received ₹${paymentRow.amount} (Payment ID: ${payment.id}) on order ${orderId} but slot was taken. Automated refund call failed. MANUAL REFUND REQUIRED.`);

        // Notify customer that refund is in progress
        await sendWhatsAppCancellation(orderId, 100, paymentRow.amount);
      }

      return NextResponse.json({ received: true });
    }

    // ── Handle tournament payments (webhook fallback) ─────────────────────────
    // Fires when Razorpay captures payment but the client callback failed
    // (browser closed, network drop). Ensures no paid player is left unregistered.
    try {
      const { data: tournamentReg } = await (admin
        .from("tournament_registrations" as any) as any)
        .select("id, pass_id, status")
        .eq("razorpay_order_id", payment.order_id)
        .maybeSingle();

      if (tournamentReg && tournamentReg.status !== "paid") {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let suffix = "";
        for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
        const passId = tournamentReg.pass_id || `GH-POOL-${suffix}`;

        await (admin.from("tournament_registrations" as any) as any)
          .update({ status: "paid", payment_id: payment.id, pass_id: passId })
          .eq("id", tournamentReg.id);

        console.log(`[Webhook] Tournament ${tournamentReg.id} confirmed via webhook fallback. Pass: ${passId}`);
      }
    } catch (err) {
      console.error("[Webhook] Tournament fallback check failed:", err);
    }
  }

  return NextResponse.json({ received: true });
}
