import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

/**
 * Validate a coupon code against all rules (active, date window, usage cap,
 * location scope) and return the resolved discount amount for a given subtotal.
 *
 * Returns ok({ valid: false, reason }) on a known invalid code so the UI can
 * show a friendly message without treating it as an error.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code       = searchParams.get("code")?.trim().toUpperCase() ?? "";
  const locationId = searchParams.get("location_id") ?? "";
  const amount     = Number(searchParams.get("amount") ?? 0);

  if (!code) {
    return NextResponse.json(err("code is required", "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const { data: coupon } = await admin
    .from("coupons")
    .select("*")
    .eq("code", code)
    .maybeSingle();

  if (!coupon) {
    return NextResponse.json(ok({ valid: false, reason: "Invalid coupon code" }));
  }
  if (!coupon.is_active) {
    return NextResponse.json(ok({ valid: false, reason: "This code is no longer active" }));
  }

  const now = Date.now();
  if (coupon.valid_from && new Date(coupon.valid_from).getTime() > now) {
    return NextResponse.json(ok({ valid: false, reason: "This code is not active yet" }));
  }
  if (coupon.valid_until && new Date(coupon.valid_until).getTime() < now) {
    return NextResponse.json(ok({ valid: false, reason: "This code has expired" }));
  }
  if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
    return NextResponse.json(ok({ valid: false, reason: "This code has reached its usage limit" }));
  }
  if (coupon.location_id && locationId && coupon.location_id !== locationId) {
    return NextResponse.json(ok({ valid: false, reason: "This code isn't valid at this location" }));
  }

  // Compute discount against the provided amount (defensive — caller can pass 0
  // just to validate the code, then call again with real amount on submit)
  let discountAmount = 0;
  if (amount > 0) {
    if (coupon.discount_type === "percent") {
      discountAmount = Math.round((amount * coupon.discount_value) / 100 * 100) / 100;
    } else {
      discountAmount = coupon.discount_value;
    }
    discountAmount = Math.min(discountAmount, amount);
  }

  return NextResponse.json(
    ok({
      valid:           true,
      coupon_id:       coupon.id,
      code:            coupon.code,
      discount_type:   coupon.discount_type,
      discount_value:  coupon.discount_value,
      discount_amount: discountAmount,
    })
  );
}
