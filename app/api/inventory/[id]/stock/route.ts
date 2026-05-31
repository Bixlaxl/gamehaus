import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

const adjustSchema = z.object({
  // Positive = restock or upward adjustment, negative = waste / count-down.
  change: z.number().int().refine((n) => n !== 0, "Change cannot be zero"),
  reason: z.enum(["restock", "adjustment"]),
  note:   z.string().max(200).optional(),
});

// Both owner and staff can adjust stock; staff is constrained to their own
// location's items (enforced by the location check below).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = adjustSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();

  // Authz: owners can touch any item; staff only their own location's
  const { data: viewer } = await admin
    .from("users")
    .select("role, location_id")
    .eq("id", session.user.id)
    .single();
  if (!viewer) return NextResponse.json(err("Profile missing", "FORBIDDEN"), { status: 403 });

  const { data: item } = await admin
    .from("inventory_items")
    .select("id, location_id, stock_count")
    .eq("id", id)
    .single();
  if (!item) return NextResponse.json(err("Item not found", "NOT_FOUND"), { status: 404 });

  if (viewer.role === "staff" && viewer.location_id !== item.location_id) {
    return NextResponse.json(err("Item belongs to a different location", "FORBIDDEN"), { status: 403 });
  }

  const newCount = item.stock_count + parsed.data.change;
  if (newCount < 0) {
    return NextResponse.json(err("Adjustment would push stock below zero", "INVALID_STATE"), { status: 400 });
  }

  // No native row-level transaction over Edge HTTP; we accept best-effort
  // consistency since stock is non-critical (small race window for two
  // concurrent restocks is fine for this domain).
  const { error: updErr } = await admin
    .from("inventory_items")
    .update({ stock_count: newCount })
    .eq("id", id);
  if (updErr) return NextResponse.json(err(updErr.message, "DB_ERROR"), { status: 500 });

  await admin.from("inventory_stock_logs").insert({
    inventory_item_id: id,
    location_id:       item.location_id,
    change:            parsed.data.change,
    reason:            parsed.data.reason,
    note:              parsed.data.note ?? null,
    created_by:        session.user.id,
  });

  return NextResponse.json(ok({ stock_count: newCount }));
}

// GET /api/inventory/[id]/stock?limit=50 → recent log entries for this item
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const url   = new URL(request.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50")));

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("inventory_stock_logs")
    .select("*, actor:users!inventory_stock_logs_created_by_fkey(name)")
    .eq("inventory_item_id", id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data ?? []));
}
