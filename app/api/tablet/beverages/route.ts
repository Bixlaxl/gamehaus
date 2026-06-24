import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("location_id");
  if (!locationId) {
    return NextResponse.json(err("location_id required", "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const { data: items, error } = await admin
    .from("inventory_items")
    .select("id, name, category, selling_price, image_url, stock_count")
    .eq("location_id", locationId)
    .eq("is_active", true)
    .gt("stock_count", 0)
    .order("category")
    .order("sort_order")
    .order("name");

  if (error) {
    return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  }

  return NextResponse.json(ok(items ?? []));
}
