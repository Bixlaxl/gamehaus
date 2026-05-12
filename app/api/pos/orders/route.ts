import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/validators/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("locationId");
  if (!locationId) return NextResponse.json(err("locationId required", "VALIDATION_ERROR"), { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orders")
    .select("*, items:order_items(*, table:tables(*)), extras:order_extras(*)")
    .eq("location_id", locationId)
    .eq("status", "open");

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data ?? []));
}
