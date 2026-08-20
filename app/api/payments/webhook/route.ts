import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppSettings } from "@/lib/settings";
import { sendWhatsAppConfirmation } from "@/lib/whatsapp";

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
      .select("id, order_id, amount, status")
      .eq("razorpay_order_id", payment.order_id)
      .single();

    if (paymentRow) {
      if (paymentRow.status === "completed") {
        console.log(`[Webhook] Payment ${paymentRow.id} already completed. Skipping.`);
        return NextResponse.json({ received: true });
      }

      const now = new Date().toISOString();
      const orderId = paymentRow.order_id;

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

      const { data: order } = await admin
        .from("orders")
        .select("customer_phone, customer_name, points_redeemed")
        .eq("id", orderId)
        .single();

      await Promise.all([
        admin.from("payments").update({
          status: "completed",
          razorpay_payment_id: payment.id,
          collected_at: now,
        }).eq("id", paymentRow.id),
        admin.from("orders").update({
          status: "open",
          advance_paid: paymentRow.amount,
          points_redeemed_online: order?.points_redeemed ?? 0,
        }).eq("id", orderId),
        admin.from("order_items").update({ status: "scheduled" }).eq("order_id", orderId).eq("status", "cancelled"),
        bookingsPromise,
      ]);

      if (order?.customer_phone) {
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

      await sendWhatsAppConfirmation(paymentRow.order_id);
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
