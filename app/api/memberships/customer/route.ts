import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const phone = searchParams.get("phone");

  if (!phone) {
    return NextResponse.json(err("phone is required", "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const now   = new Date().toISOString();

  const { data, error } = await admin
    .from("customer_memberships")
    .select(`*, plan:membership_plans(*)`)
    .eq("customer_phone", phone)
    .eq("is_active", true)
    .gte("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  return NextResponse.json(ok(data ?? null));
}
