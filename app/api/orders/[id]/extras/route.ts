import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addExtraSchema, ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';
export const dynamic = "force-dynamic";


export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });
  const user = session.user;

  const body: unknown = await request.json();
  const parsed = addExtraSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .single();

  if (!order || order.status !== "open") {
    return NextResponse.json(err("Order not found or not open", "INVALID_STATE"), { status: 400 });
  }

  const { name, price, cost_price, quantity, inventory_item_id } = parsed.data;

  const { data: extra, error } = await admin
    .from("order_extras")
    .insert({
      order_id: orderId,
      name,
      price,
      cost_price: cost_price ?? 0,
      quantity,
      inventory_item_id: inventory_item_id ?? null,
      added_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  // Auto-deduct stock when the extra is sourced from the catalogue. We
  // deliberately allow the count to go below zero (toast/badge surfaces it
  // in the UI) rather than blocking the sale — the floor staff might be
  // ahead of the restock entry, and we never want to block revenue.
  if (inventory_item_id) {
    const { data: invItem } = await admin
      .from("inventory_items")
      .select("location_id, stock_count")
      .eq("id", inventory_item_id)
      .single();
    if (invItem) {
      await Promise.all([
        admin
          .from("inventory_items")
          .update({ stock_count: invItem.stock_count - quantity })
          .eq("id", inventory_item_id),
        admin.from("inventory_stock_logs").insert({
          inventory_item_id,
          location_id:    invItem.location_id,
          change:         -quantity,
          reason:         "sale",
          order_extra_id: extra.id,
          created_by:     user.id,
        }),
      ]);
    }
  }

  return NextResponse.json(ok(extra));
}
