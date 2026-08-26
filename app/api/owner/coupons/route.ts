import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { data: viewer } = await supabase
    .from("users")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (!viewer || viewer.role !== "owner") {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  try {
    const body = await request.json();
    const admin = createAdminClient();

    const code = (body.code ?? "").trim().toUpperCase();
    if (!code) {
      return NextResponse.json(err("Coupon code is required", "VALIDATION_ERROR"), { status: 400 });
    }

    // Check if code already exists
    const { data: existing } = await admin
      .from("coupons")
      .select("id, code")
      .eq("code", code)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(err(`A coupon with code "${code}" already exists. Please edit or delete it first.`, "DUPLICATE_CODE"), { status: 400 });
    }

    const payload: any = {
      code,
      discount_type:    body.discount_type,
      discount_value:   parseFloat(body.discount_value),
      location_id:      body.location_id === "all" ? null : (body.location_id ?? null),
      valid_from:       body.valid_from,
      valid_until:      body.valid_until,
      valid_from_time:  body.valid_from_time ?? null,
      valid_until_time: body.valid_until_time ?? null,
      max_uses:         body.max_uses ? parseInt(body.max_uses) : null,
      is_public:        body.is_public ?? false,
      is_active:        true,
    };

    if (body.valid_days && Array.isArray(body.valid_days) && body.valid_days.length > 0) {
      payload.valid_days = body.valid_days;
    }

    let { data: inserted, error: insertError } = await admin
      .from("coupons")
      .insert(payload)
      .select("*, location:locations(name)")
      .single();

    if (insertError && insertError.message.includes("valid_days")) {
      delete payload.valid_days;
      const retry = await admin
        .from("coupons")
        .insert(payload)
        .select("*, location:locations(name)")
        .single();
      inserted = retry.data;
      insertError = retry.error;
    }

    if (insertError) {
      return NextResponse.json(err(insertError.message, "DB_ERROR"), { status: 500 });
    }

    return NextResponse.json(ok(inserted));
  } catch (error: any) {
    return NextResponse.json(err(error.message || "Failed to create coupon", "SERVER_ERROR"), { status: 500 });
  }
}
