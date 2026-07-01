import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get("phone") || "9363381136";
    const membershipId = searchParams.get("membership_id");

    const admin = createAdminClient();
    const nowIso = new Date().toISOString();

    const [memberships, profile, orders] = await Promise.all([
      admin
        .from("customer_memberships")
        .select("*, plan:membership_plans(*)")
        .eq("customer_phone", phone),
      admin
        .from("customer_profiles")
        .select("*")
        .eq("phone", phone),
      admin
        .from("orders")
        .select("*, items:order_items(*)")
        .eq("customer_phone", phone)
        .order("created_at", { ascending: false })
        .limit(5)
    ]);

    return NextResponse.json({
      success: true,
      phone,
      nowIso,
      membershipId,
      profile: profile.data,
      memberships: memberships.data,
      orders: orders.data,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message });
  }
}
