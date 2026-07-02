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

    // Query all locations
    const { data: locations, error: locError } = await admin
      .from("locations")
      .select("id, name");

    if (locError) {
      return NextResponse.json({ success: false, error: "Locations fetch error: " + locError.message });
    }

    // Query orders count per location
    const orderCounts: Record<string, { total: number; before2026: number; in2026: number; months: Record<string, number> }> = {};
    
    for (const loc of locations ?? []) {
      const { data: orders } = await admin
        .from("orders")
        .select("created_at")
        .eq("location_id", loc.id);

      const stats = {
        total: orders?.length || 0,
        before2026: 0,
        in2026: 0,
        months: {} as Record<string, number>
      };

      for (const o of orders ?? []) {
        const created = new Date(o.created_at);
        if (created.getFullYear() < 2026) {
          stats.before2026 += 1;
        } else {
          stats.in2026 += 1;
        }
        const mKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
        stats.months[mKey] = (stats.months[mKey] || 0) + 1;
      }

      orderCounts[loc.name] = stats;
    }

    // Query details of user "Nissan" to see what rows exist for him
    const { data: nissanProfiles } = await admin
      .from("customer_profiles")
      .select("*")
      .ilike("name", "%nissan%");

    // Query first 5 Nerf Turf orders to check raw timestamps
    let sampleOrders: any[] = [];
    if (locations) {
      const nerfLoc = locations.find(l => l.name.toLowerCase().includes("nerf"));
      if (nerfLoc) {
        const { data: rawOrders } = await admin
          .from("orders")
          .select("id, customer_name, customer_phone, created_at, finalized_at, total_amount")
          .eq("location_id", nerfLoc.id)
          .limit(5);
        sampleOrders = rawOrders || [];
      }
    }

    return NextResponse.json({
      success: true,
      locations,
      orderCounts,
      sampleOrders,
      nissanProfiles
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message });
  }
}
