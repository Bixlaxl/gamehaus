import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';

const patchSchema = z.object({
  quantity: z.number().int().min(1),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; extraId: string }> }
) {
  const { extraId } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  // Snapshot the old quantity so we can compute the stock delta after update.
  const { data: existing } = await admin
    .from("order_extras")
    .select("inventory_item_id, quantity")
    .eq("id", extraId)
    .single();

  const { data, error } = await admin
    .from("order_extras")
    .update({ quantity: parsed.data.quantity })
    .eq("id", extraId)
    .select()
    .single();

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  // If quantity changed and this extra is linked to a stock item, adjust by
  // the difference (positive delta = sold more = stock down).
  if (existing?.inventory_item_id && existing.quantity !== parsed.data.quantity) {
    const delta = parsed.data.quantity - existing.quantity; // sold more = positive
    const { data: invItem } = await admin
      .from("inventory_items")
      .select("location_id, stock_count")
      .eq("id", existing.inventory_item_id)
      .single();
    if (invItem) {
      await Promise.all([
        admin
          .from("inventory_items")
          .update({ stock_count: invItem.stock_count - delta })
          .eq("id", existing.inventory_item_id),
        admin.from("inventory_stock_logs").insert({
          inventory_item_id: existing.inventory_item_id,
          location_id:       invItem.location_id,
          change:            -delta,
          reason:            delta > 0 ? "sale" : "reverse",
          order_extra_id:    extraId,
          created_by:        session.user.id,
        }),
      ]);
    }
  }

  return NextResponse.json(ok(data));
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; extraId: string }> }
) {
  const { extraId } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const admin = createAdminClient();
  // Capture pre-delete state so we can restore stock if it was a catalogue item.
  const { data: existing } = await admin
    .from("order_extras")
    .select("inventory_item_id, quantity, is_deleted")
    .eq("id", extraId)
    .single();

  const { error } = await admin
    .from("order_extras")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", extraId);

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  // Restore stock — but only if the extra was actually live (not already
  // soft-deleted), so a double-delete can't keep adding to stock.
  if (existing && !existing.is_deleted && existing.inventory_item_id) {
    const { data: invItem } = await admin
      .from("inventory_items")
      .select("location_id, stock_count")
      .eq("id", existing.inventory_item_id)
      .single();
    if (invItem) {
      await Promise.all([
        admin
          .from("inventory_items")
          .update({ stock_count: invItem.stock_count + existing.quantity })
          .eq("id", existing.inventory_item_id),
        admin.from("inventory_stock_logs").insert({
          inventory_item_id: existing.inventory_item_id,
          location_id:       invItem.location_id,
          change:            existing.quantity,
          reason:            "reverse",
          order_extra_id:    extraId,
          created_by:        session.user.id,
        }),
      ]);
    }
  }

  return NextResponse.json(ok({ deleted: true }));
}
