import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

/**
 * GET /api/inventory/low-stock-count?location_id=<uuid>
 *
 * Returns { count, out_of_stock } across active inventory items where
 * stock_count <= low_stock_threshold. Used by the nav badge in both the
 * owner sidebar and the POS side rail so the badge can update without
 * pulling every item row.
 *
 * Filtering happens client-side (Supabase can't compare two columns in a
 * WHERE clause directly through the JS client), but the result is tiny.
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
    .select("stock_count, low_stock_threshold")
    .eq("is_active", true);
  if (locationId) q = q.eq("location_id", locationId);

  const { data, error } = await q;
  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  let count = 0;
  let outOfStock = 0;
  for (const row of data ?? []) {
    if (row.stock_count <= row.low_stock_threshold) count++;
    if (row.stock_count <= 0) outOfStock++;
  }

  return NextResponse.json(ok({ count, out_of_stock: outOfStock }));
}
