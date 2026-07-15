import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  // Authorization check: owner only
  const { data: viewer } = await supabase
    .from("users")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (!viewer || viewer.role !== "owner") {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  const url = new URL(request.url);
  const locationId = url.searchParams.get("location_id");
  const createdBy = url.searchParams.get("created_by");
  const itemId = url.searchParams.get("inventory_item_id");
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50")));

  const admin = createAdminClient();
  let query = admin
    .from("inventory_stock_logs")
    .select("*, item:inventory_items(name), actor:users!inventory_stock_logs_created_by_fkey(name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  const type = url.searchParams.get("type");

  if (locationId && locationId !== "all") {
    query = query.eq("location_id", locationId);
  }
  if (createdBy && createdBy !== "all") {
    query = query.eq("created_by", createdBy);
  }
  if (itemId && itemId !== "all") {
    query = query.eq("inventory_item_id", itemId);
  }
  if (type === "staff") {
    query = query.eq("reason", "adjustment").ilike("note", "%Staff consumption%");
  } else if (type === "customer") {
    query = query.in("reason", ["sale", "reverse"]);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  return NextResponse.json(ok(data ?? []));
}
