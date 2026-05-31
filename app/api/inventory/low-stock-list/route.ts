import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

/**
 * GET /api/inventory/low-stock-list?location_id=<uuid>
 *
 * Returns the actual list of items currently at or below their
 * low_stock_threshold. Used by the bell-dropdown to show staff/owner what
 * specifically needs attention (and to drive the one-time toast alerts).
 *
 * Owner: omit location_id to see all locations.
 * Staff: pass their own location_id.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("location_id");

  const admin = createAdminClient();
  let q = admin
    .from("inventory_items")
    .select("id, name, stock_count, low_stock_threshold, location_id, image_url, selling_price, location:locations(name)")
    .eq("is_active", true);
  if (locationId) q = q.eq("location_id", locationId);

  const { data, error } = await q;
  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  const items = (data ?? [])
    .filter((r) => r.stock_count <= r.low_stock_threshold)
    // Worst first: out-of-stock at the top, then closest to threshold
    .sort((a, b) => (a.stock_count - a.low_stock_threshold) - (b.stock_count - b.low_stock_threshold));

  return NextResponse.json(ok(items));
}
