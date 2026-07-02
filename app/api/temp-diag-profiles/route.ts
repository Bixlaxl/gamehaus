import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const passcode = searchParams.get("passcode");
    if (passcode !== "gamehaus-import-2026") {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Query specific sample phones from customers (1).csv
    const samplePhones = ["9884525101", "6379674060", "8695823456", "9941935430", "9994166622", "8248779649"];
    
    const { data: profiles, error: profError } = await admin
      .from("customer_profiles")
      .select("*")
      .in("phone", samplePhones);

    if (profError) {
      return NextResponse.json({ success: false, error: "Profiles fetch error: " + profError.message });
    }

    const { data: plans } = await admin.from("membership_plans").select("*");
    const { data: memberships } = await admin
      .from("customer_memberships")
      .select("*, plan:membership_plans(name)")
      .eq("customer_phone", "8248779649");

    // Query count of all profiles
    const { count, error: countError } = await admin
      .from("customer_profiles")
      .select("*", { count: "exact", head: true });

    // Query count of all NerfTurf orders
    const { data: nerfLoc } = await admin.from("locations").select("id, name");
    const nerfId = nerfLoc?.find(l => l.name.toLowerCase().includes("nerf"))?.id;
    
    let nerfOrdersCount = 0;
    if (nerfId) {
      const { count: oCount } = await admin
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("location_id", nerfId);
      nerfOrdersCount = oCount || 0;
    }

    return NextResponse.json({
      success: true,
      totalProfiles: count,
      nerfLocationId: nerfId,
      nerfOrdersCount,
      plans,
      memberships,
      profiles
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message });
  }
}
