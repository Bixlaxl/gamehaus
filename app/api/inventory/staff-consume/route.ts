import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

const staffConsumeSchema = z.object({
  inventoryItemId: z.string().uuid("Invalid item ID"),
  quantity: z.number().int().min(1, "Quantity must be at least 1"),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = staffConsumeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { inventoryItemId, quantity } = parsed.data;
  const admin = createAdminClient();

  // Load user profile role and location
  const { data: viewer } = await admin
    .from("users")
    .select("role, location_id")
    .eq("id", session.user.id)
    .single();
  if (!viewer) return NextResponse.json(err("Profile missing", "FORBIDDEN"), { status: 403 });

  // Load inventory item
  const { data: item } = await admin
    .from("inventory_items")
    .select("id, location_id, stock_count, name")
    .eq("id", inventoryItemId)
    .single();
  if (!item) return NextResponse.json(err("Item not found", "NOT_FOUND"), { status: 404 });

  // Staff can only consume items at their own location
  if (viewer.role === "staff" && viewer.location_id !== item.location_id) {
    return NextResponse.json(err("This item belongs to a different location", "FORBIDDEN"), { status: 403 });
  }

  const newCount = item.stock_count - quantity;
  if (newCount < 0) {
    return NextResponse.json(err(`Intake would push ${item.name} stock below zero`, "INVALID_STATE"), { status: 400 });
  }

  // Update inventory count
  const { error: updErr } = await admin
    .from("inventory_items")
    .update({ stock_count: newCount })
    .eq("id", inventoryItemId);
  if (updErr) return NextResponse.json(err(updErr.message, "DB_ERROR"), { status: 500 });

  // Log stock transaction
  const { error: logErr } = await admin.from("inventory_stock_logs").insert({
    inventory_item_id: inventoryItemId,
    location_id:       item.location_id,
    change:            -quantity,
    reason:            "adjustment",
    note:              `Staff consumption logged by ${session.user.email}`,
    created_by:        session.user.id,
  });
  if (logErr) return NextResponse.json(err(logErr.message, "DB_ERROR"), { status: 500 });

  return NextResponse.json(ok({ stock_count: newCount }));
}
