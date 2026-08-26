import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
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

  const { id } = params;
  if (!id) return NextResponse.json(err("Coupon ID required", "VALIDATION_ERROR"), { status: 400 });

  try {
    const body = await request.json();
    const admin = createAdminClient();

    // If code is being updated, verify it doesn't conflict with another coupon
    if (body.code) {
      const code = body.code.trim().toUpperCase();
      const { data: existing } = await admin
        .from("coupons")
        .select("id")
        .eq("code", code)
        .neq("id", id)
        .maybeSingle();

      if (existing) {
        return NextResponse.json(err(`A different coupon with code "${code}" already exists.`, "DUPLICATE_CODE"), { status: 400 });
      }
      body.code = code;
    }

    const payload: any = {};
    if (body.code !== undefined) payload.code = body.code;
    if (body.discount_type !== undefined) payload.discount_type = body.discount_type;
    if (body.discount_value !== undefined) payload.discount_value = parseFloat(body.discount_value);
    if (body.location_id !== undefined) payload.location_id = body.location_id === "all" ? null : body.location_id;
    if (body.valid_from !== undefined) payload.valid_from = body.valid_from;
    if (body.valid_until !== undefined) payload.valid_until = body.valid_until;
    if (body.valid_from_time !== undefined) payload.valid_from_time = body.valid_from_time;
    if (body.valid_until_time !== undefined) payload.valid_until_time = body.valid_until_time;
    if (body.max_uses !== undefined) payload.max_uses = body.max_uses ? parseInt(body.max_uses) : null;
    if (body.is_public !== undefined) payload.is_public = body.is_public;
    if (body.is_active !== undefined) payload.is_active = body.is_active;
    if (body.valid_days !== undefined) payload.valid_days = body.valid_days;

    let { data: updated, error: updateError } = await admin
      .from("coupons")
      .update(payload)
      .eq("id", id)
      .select("*, location:locations(name)")
      .single();

    if (updateError && updateError.message.includes("valid_days")) {
      delete payload.valid_days;
      const retry = await admin
        .from("coupons")
        .update(payload)
        .eq("id", id)
        .select("*, location:locations(name)")
        .single();
      updated = retry.data;
      updateError = retry.error;
    }

    if (updateError) {
      return NextResponse.json(err(updateError.message, "DB_ERROR"), { status: 500 });
    }

    return NextResponse.json(ok(updated));
  } catch (error: any) {
    return NextResponse.json(err(error.message || "Failed to update coupon", "SERVER_ERROR"), { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
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

  const { id } = params;
  if (!id) return NextResponse.json(err("Coupon ID required", "VALIDATION_ERROR"), { status: 400 });

  try {
    const admin = createAdminClient();

    // 1. Unlink from any historical orders to prevent foreign key violation
    await admin.from("orders").update({ coupon_id: null }).eq("coupon_id", id);

    // 2. Permanently delete the coupon row to free up the unique code
    const { error: deleteError } = await admin
      .from("coupons")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json(err(deleteError.message, "DB_ERROR"), { status: 500 });
    }

    return NextResponse.json(ok({ success: true, deleted_id: id }));
  } catch (error: any) {
    return NextResponse.json(err(error.message || "Failed to delete coupon", "SERVER_ERROR"), { status: 500 });
  }
}
