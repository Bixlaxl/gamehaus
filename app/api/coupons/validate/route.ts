import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";
import { calculateCouponDiscount } from "@/lib/coupons";

export const runtime = "edge";

/**
 * Validate a coupon code against all rules (active, date window, time window, usage cap,
 * location scope) and return the resolved discount amount for a given subtotal.
 * Supports pro-rated discounts for slots partially overlapping with Happy Hours.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code       = searchParams.get("code")?.trim().toUpperCase() ?? "";
  const locationId = searchParams.get("location_id") ?? "";
  const amount     = Number(searchParams.get("amount") ?? 0);
  const slotStart  = searchParams.get("slot_start") ?? searchParams.get("scheduled_start") ?? "";
  const slotEnd    = searchParams.get("slot_end") ?? searchParams.get("scheduled_end") ?? "";

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

  // Calculate pro-rated discount and check day/time window
  const calc = calculateCouponDiscount(coupon, slotStart, slotEnd, amount);
  if (!calc.valid) {
    return NextResponse.json(ok({
      valid: false,
      reason: calc.reason ?? "Coupon is not applicable to this slot"
    }));
  }

  return NextResponse.json(
    ok({
      valid:           true,
      coupon_id:       coupon.id,
      code:            coupon.code,
      discount_type:   coupon.discount_type,
      discount_value:  coupon.discount_value,
      discount_amount: calc.discount_amount,
      is_prorated:     calc.is_prorated,
      overlap_minutes: calc.overlap_minutes,
      total_minutes:   calc.total_minutes,
    })
  );
}
