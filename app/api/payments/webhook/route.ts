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
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET!;

  if (!(await verifyHmac(secret, body, signature))) {
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

  if (event.event === "payment.captured") {
    const payment = event.payload.payment.entity;
    const admin = createAdminClient();

    // Find our payment row by razorpay_order_id
    const { data: paymentRow } = await admin
      .from("payments")
      .select("id, order_id, amount, status")
      .eq("razorpay_order_id", payment.order_id)
      .single();

    if (paymentRow) {
      if (paymentRow.status === "completed") {
        console.log(`[Webhook] Payment ${payment.id} for order ${payment.order_id} is already completed. Skipping duplicate execution.`);
        return NextResponse.json({ received: true, already_processed: true });
      }

      const now = new Date().toISOString();

      // All three are independent — run in parallel
      const [, , { data: order }] = await Promise.all([
        admin.from("payments").update({
          status:              "completed",
          razorpay_payment_id: payment.id,
          collected_at:        now,
        }).eq("id", paymentRow.id),
        admin.from("orders").update({ advance_paid: paymentRow.amount }).eq("id", paymentRow.order_id),
        admin.from("orders").select("customer_phone, customer_name, points_redeemed").eq("id", paymentRow.order_id).single(),
      ]);

      if (order?.customer_phone) {
        const settings = await getAppSettings(admin);
        const pointsEarned = Math.floor(paymentRow.amount / settings.loyalty.earn_rupees_per_point);
        const netPoints    = pointsEarned - (order.points_redeemed ?? 0);

        const { data: profile } = await admin
          .from("customer_profiles")
          .select("points_balance, visit_count, total_spent")
          .eq("phone", order.customer_phone)
          .single();

        if (profile) {
          await admin.from("customer_profiles").update({
            points_balance: Math.max(0, profile.points_balance + netPoints),
            total_spent:    profile.total_spent + paymentRow.amount,
            last_visit_at:  now,
          }).eq("phone", order.customer_phone);
        } else {
          await admin.from("customer_profiles").insert({
            phone:          order.customer_phone,
            name:           order.customer_name,
            points_balance: Math.max(0, netPoints),
            visit_count:    1,
            total_spent:    paymentRow.amount,
            last_visit_at:  now,
          });
        }
      }

      // Trigger WhatsApp booking confirmation notification
      await sendWhatsAppConfirmation(paymentRow.order_id);
    }
  }

  return NextResponse.json({ received: true });
}
