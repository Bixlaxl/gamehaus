import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

/**
 * GET /api/coupons/active?location_id=xxx
 * Returns currently valid public coupons.
 * If location_id is provided, returns coupons that are global OR specific to that location.
 * If location_id is not provided, returns all active public coupons.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("location_id") || null;

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: coupons, error } = await admin
    .from("coupons")
    .select("*")
    .eq("is_active", true)
    .eq("is_public", true)
    .lte("valid_from", now)
    .gte("valid_until", now);

  if (error) {
    return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  }

  // Filter in JS for max_uses and location_id
  const active = (coupons ?? []).filter((coupon) => {
    // Check usage cap
    if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
      return false;
    }
    // Check location_id filter if requested
    if (locationId) {
      if (coupon.location_id && coupon.location_id !== locationId) {
        return false;
      }
    }
    return true;
  });

  return NextResponse.json(ok(active));
}
