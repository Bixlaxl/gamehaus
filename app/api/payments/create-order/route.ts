import { NextResponse } from "next/server";
import { z } from "zod";
import { ok, err } from "@/lib/validators/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = 'nodejs';

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
    const keyId = (process.env.RAZORPAY_KEY_ID || "").trim();
    const keySecret = (process.env.RAZORPAY_KEY_SECRET || "").trim();
    const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ amount, currency, receipt, notes: { order_id } }),
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
      hasKeyId: !!process.env.RAZORPAY_KEY_ID,
      keyIdStart: process.env.RAZORPAY_KEY_ID ? process.env.RAZORPAY_KEY_ID.substring(0, 8) : "none",
      hasKeySecret: !!process.env.RAZORPAY_KEY_SECRET,
      secretLength: process.env.RAZORPAY_KEY_SECRET ? process.env.RAZORPAY_KEY_SECRET.length : 0,
    });
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
