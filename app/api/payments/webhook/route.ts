import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET!;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  if (expectedSignature !== signature) {
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
      .select("id, order_id, amount")
      .eq("razorpay_order_id", payment.order_id)
      .single();

    if (paymentRow) {
      // Mark payment completed
      await admin.from("payments").update({
        status: "completed",
        razorpay_payment_id: payment.id,
        collected_at: new Date().toISOString(),
      }).eq("id", paymentRow.id);

      // Update order's advance_paid so POS shows what was already collected
      await admin.from("orders").update({
        advance_paid: paymentRow.amount,
      }).eq("id", paymentRow.order_id);
    }
  }

  return NextResponse.json({ received: true });
}
