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

    // 1. Fetch total count of finalized orders
    const { count, error: countError } = await admin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "finalized");

    // 2. Fetch a sample of recent finalized orders
    const { data: sample, error: sampleError } = await admin
      .from("orders")
      .select("id, customer_name, customer_phone, finalized_at, amount_due")
      .eq("status", "finalized")
      .order("finalized_at", { ascending: false })
      .limit(10);

    // 3. Count orders in range June 3 to July 2
    const fromISO = new Date("2026-06-03T10:00:00+05:30").toISOString();
    const toISO = new Date("2026-07-02T23:00:00+05:30").toISOString();

    const { count: rangeCount, error: rangeError } = await admin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "finalized")
      .gte("finalized_at", fromISO)
      .lte("finalized_at", toISO);

    // 4. Check if there are orders in any range or locations
    const { data: locations } = await admin.from("locations").select("id, name");

    return NextResponse.json({
      success: true,
      totalFinalized: count,
      rangeCount,
      fromISO,
      toISO,
      sample,
      locations
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message });
  }
}
