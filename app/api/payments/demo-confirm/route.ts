import { NextResponse } from "next/server";
import { z } from "zod";
import { ok, err } from "@/lib/validators/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppSettings } from "@/lib/settings";

export const runtime = 'edge';


// Demo-only route — bypasses Razorpay for local testing
// Remove or gate behind env flag before going live

const schema = z.object({
  order_id:        z.string().uuid(),
  amount:          z.number().positive(), // in rupees
  points_redeemed: z.number().int().min(0).default(0),
});

export async function POST(request: Request) {
  const body: unknown = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { order_id, amount, points_redeemed } = parsed.data;
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Fetch order to get customer phone
  const { data: order } = await admin
    .from("orders")
    .select("customer_phone, customer_name, advance_paid")
    .eq("id", order_id)
    .single();

  if (!order) {
    return NextResponse.json(err("Order not found", "NOT_FOUND"), { status: 404 });
  }

  // Mark payment completed
  await admin.from("payments").insert({
    order_id,
    amount,
    method:       "razorpay",
    status:       "completed",
    collected_at: now,
  });

  // Update advance_paid on the order + store points_redeemed
  await admin.from("orders").update({
    advance_paid:    amount,
    points_redeemed,
  }).eq("id", order_id);

  // Award / deduct loyalty points
  if (order.customer_phone) {
    const settings = await getAppSettings(admin);
    const pointsEarned = Math.floor(amount / settings.loyalty.earn_rupees_per_point);
    const netPoints    = pointsEarned - points_redeemed;

    const { data: profile } = await admin
      .from("customer_profiles")
      .select("points_balance, visit_count, total_spent")
      .eq("phone", order.customer_phone)
      .single();

    if (profile) {
      await admin.from("customer_profiles").update({
        points_balance: Math.max(0, profile.points_balance + netPoints),
        total_spent:    profile.total_spent + amount,
        last_visit_at:  now,
      }).eq("phone", order.customer_phone);
    } else {
      await admin.from("customer_profiles").insert({
        phone:          order.customer_phone,
        name:           order.customer_name,
        points_balance: Math.max(0, pointsEarned - points_redeemed),
        visit_count:    1,
        total_spent:    amount,
        last_visit_at:  now,
      });
    }
  }

  return NextResponse.json(ok({ confirmed: true }));
}
