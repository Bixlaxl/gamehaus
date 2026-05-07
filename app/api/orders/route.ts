import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOrderSchema, ok, err } from "@/lib/validators/schemas";

export async function POST(request: Request) {
  const body: unknown = await request.json();
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { location_id, type, customer_name, customer_phone, items } = parsed.data;

  // Online orders: public customers aren't logged in, use admin client
  // Walk-in orders: require staff authentication
  const admin = createAdminClient();
  let createdBy: string | null = null;

  if (type === "walk_in") {
    const serverClient = await createClient();
    const { data: { user } } = await serverClient.auth.getUser();
    if (!user) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });
    createdBy = user.id;
  }

  // Create order
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      location_id,
      type,
      customer_name,
      customer_phone: customer_phone ?? null,
      created_by: createdBy,
    })
    .select()
    .single();

  if (orderError || !order) {
    return NextResponse.json(err(orderError?.message ?? "Failed to create order", "DB_ERROR"), { status: 500 });
  }

  // Create order items — select back IDs and schedule times for bookings
  const { data: createdItems, error: itemsError } = await admin
    .from("order_items")
    .insert(
      items.map((item) => ({
        order_id: order.id,
        table_id: item.table_id,
        scheduled_start: item.scheduled_start ?? null,
        scheduled_end: item.scheduled_end ?? null,
        scheduled_duration_mins: item.scheduled_duration_mins ?? null,
        rate_per_hour: item.rate_per_hour,
      }))
    )
    .select("id, scheduled_start, scheduled_end");

  if (itemsError || !createdItems) {
    await admin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    return NextResponse.json(err(itemsError?.message ?? "Failed to create order items", "DB_ERROR"), { status: 500 });
  }

  // For online orders: create a bookings row per item so POS check-in can find them
  if (type === "online") {
    const bookings = createdItems
      .filter((item) => item.scheduled_start && item.scheduled_end)
      .map((item) => ({
        order_id: order.id,
        order_item_id: item.id,
        scheduled_start: item.scheduled_start!,
        scheduled_end: item.scheduled_end!,
        held_until: new Date(new Date(item.scheduled_start!).getTime() + 15 * 60 * 1000).toISOString(),
        status: "confirmed" as const,
      }));

    if (bookings.length > 0) {
      await admin.from("bookings").insert(bookings);
    }
  }

  // Upsert customer profile
  if (customer_phone) {
    await admin.from("customer_profiles").upsert(
      { phone: customer_phone, name: customer_name },
      { onConflict: "phone", ignoreDuplicates: false }
    );
  }

  return NextResponse.json(ok({ order_id: order.id }));
}
