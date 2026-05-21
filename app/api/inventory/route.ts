import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err, inventoryItemSchema } from "@/lib/validators/schemas";

export const runtime = "edge";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("location_id");

  const admin = createAdminClient();
  let query = admin
    .from("inventory_items")
    .select("*")
    .order("category")
    .order("sort_order")
    .order("name");

  if (locationId) query = query.eq("location_id", locationId);

  const { data, error } = await query;
  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  return NextResponse.json(ok(data ?? []));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body = await request.json() as unknown;
  const parsed = inventoryItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.issues[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("inventory_items")
    .insert(parsed.data)
    .select()
    .single();

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  return NextResponse.json(ok(data), { status: 201 });
}
