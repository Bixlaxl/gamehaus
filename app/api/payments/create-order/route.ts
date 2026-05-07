import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { z } from "zod";
import { ok, err } from "@/lib/validators/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  amount: z.number().positive(), // in paise
  currency: z.string().default("INR"),
  receipt: z.string(),
  order_id: z.string().uuid(), // our internal order ID
});

export async function POST(request: Request) {
  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
  const body: unknown = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { amount, currency, receipt, order_id } = parsed.data;

  const rpOrder = await razorpay.orders.create({
    amount,
    currency,
    receipt,
    notes: { order_id }, // so webhook can look up our order
  });

  // Create pending payments row so webhook has something to update
  const admin = createAdminClient();
  await admin.from("payments").insert({
    order_id,
    amount: amount / 100, // paise → rupees
    method: "razorpay",
    razorpay_order_id: rpOrder.id,
    status: "pending",
  });

  return NextResponse.json(ok({ razorpay_order_id: rpOrder.id, amount: rpOrder.amount }));
}
