import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = createAdminClient();
    const { data: memberships } = await admin
      .from("customer_memberships")
      .select("*, plan:membership_plans(*)")
      .eq("is_active", true);

    return NextResponse.json({
      success: true,
      memberships,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message });
  }
}
