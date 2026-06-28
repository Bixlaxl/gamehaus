import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("location_id");
  if (!locationId) return NextResponse.json(err("location_id required", "VALIDATION_ERROR"), { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("inventory_items")
    .select("*")
    .eq("location_id", locationId)
    .eq("is_active", true)
    .eq("show_at_checkout", true)
    .gt("stock_count", 0)
    .order("sort_order")
    .order("name");

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  return NextResponse.json(ok(data ?? []));
}
