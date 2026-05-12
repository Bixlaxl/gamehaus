import { NextResponse } from "next/server";
import { z } from "zod";
import { ok, err } from "@/lib/validators/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const schema = z.object({
  amount: z.number().positive(), // in paise
  currency: z.string().default("INR"),
  receipt: z.string(),
  order_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const body: unknown = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { amount, currency, receipt, order_id } = parsed.data;

  let rpOrder: { id: string; amount: number };
  try {
    const { default: Razorpay } = await import("razorpay");
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });
    rpOrder = await razorpay.orders.create({
      amount,
      currency,
      receipt,
      notes: { order_id },
    }) as { id: string; amount: number };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Razorpay error";
    return NextResponse.json(err(msg, "RAZORPAY_ERROR"), { status: 502 });
  }

  const admin = createAdminClient();
  await admin.from("payments").insert({
    order_id,
    amount: amount / 100,
    method: "razorpay",
    razorpay_order_id: rpOrder.id,
    status: "pending",
  });

  return NextResponse.json(ok({ razorpay_order_id: rpOrder.id, amount: rpOrder.amount }));
}
