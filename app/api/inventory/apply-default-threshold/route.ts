import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";
import { getAppSettings } from "@/lib/settings";

export const runtime = "edge";

/**
 * POST /api/inventory/apply-default-threshold
 *
 * Owner action: push the global low_stock_threshold from app_settings onto
 * every existing inventory item. The global default already applies to NEW
 * items; this is the one-click "make it actually apply everywhere" lever.
 *
 * Returns the number of rows updated.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const admin = createAdminClient();
  const { data: viewer } = await admin
    .from("users").select("role").eq("id", session.user.id).single();
  if (viewer?.role !== "owner") {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  const settings = await getAppSettings(admin);
  const threshold = settings.stock.default_low_threshold;

  // Update only items whose stored threshold differs from the global, so
  // the count we return is the actual change set.
  const { data: targets, error: selErr } = await admin
    .from("inventory_items")
    .select("id")
    .neq("low_stock_threshold", threshold);
  if (selErr) return NextResponse.json(err(selErr.message, "DB_ERROR"), { status: 500 });

  if (!targets || targets.length === 0) {
    return NextResponse.json(ok({ updated: 0, threshold }));
  }

  const { error: updErr } = await admin
    .from("inventory_items")
    .update({ low_stock_threshold: threshold })
    .in("id", targets.map((t) => t.id));
  if (updErr) return NextResponse.json(err(updErr.message, "DB_ERROR"), { status: 500 });

  return NextResponse.json(ok({ updated: targets.length, threshold }));
}
