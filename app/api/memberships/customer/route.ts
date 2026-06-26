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

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { membership_id, bound_table_ids, free_hours_ledger } = body;

    if (!membership_id) {
      return NextResponse.json(err("membership_id is required", "VALIDATION_ERROR"), { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("customer_memberships")
      .update({
        bound_table_ids: bound_table_ids ?? [],
        free_hours_ledger: free_hours_ledger ?? {},
      })
      .eq("id", membership_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
    }

    return NextResponse.json(ok(data));
  } catch (e: any) {
    return NextResponse.json(err(e.message || "Unknown error", "SERVER_ERROR"), { status: 500 });
  }
}
