import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';

const schema = z.object({
  location_id:    z.string().uuid(),
  customer_name:  z.string().min(1),
  customer_phone: z.string().optional(),
  items: z.array(z.object({
    table_id:      z.string().uuid(),
    duration_mins: z.number().int().min(15).max(480),
    rate_per_hour: z.number().positive(),
  })).min(1),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { location_id, customer_name, customer_phone, items } = parsed.data;
  const admin = createAdminClient();
  const now   = new Date();

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      location_id,
      type:           "walk_in",
      customer_name,
      customer_phone: customer_phone ?? null,
      created_by:     session.user.id,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    return NextResponse.json(err(orderError?.message ?? "Failed to create order", "DB_ERROR"), { status: 500 });
  }

  // Insert items directly in running state — combines order creation + session start into one round trip
  const itemsPromise = admin.from("order_items").insert(
    items.map((item) => ({
      order_id:                order.id,
      table_id:                item.table_id,
      rate_per_hour:           item.rate_per_hour,
      scheduled_duration_mins: item.duration_mins,
      status:                  "running" as const,
      actual_start:            now.toISOString(),
      expected_end:            new Date(now.getTime() + item.duration_mins * 60 * 1000).toISOString(),
    }))
  );

  const profilePromise = customer_phone
    ? admin.from("customer_profiles").upsert(
        { phone: customer_phone, name: customer_name },
        { onConflict: "phone", ignoreDuplicates: false }
      )
    : Promise.resolve({ data: null, error: null });

  const [{ error: itemsError }] = await Promise.all([itemsPromise, profilePromise]);

  if (itemsError) {
    await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    return NextResponse.json(err(itemsError.message, "DB_ERROR"), { status: 500 });
  }

  return NextResponse.json(ok({ order_id: order.id }));
}
