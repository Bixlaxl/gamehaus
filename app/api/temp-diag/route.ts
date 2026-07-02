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

    // Replicate /api/owner/reports logic for "Last 30 days"
    const from = "2026-06-03";
    const to = "2026-07-02";

    // 1. Fetch active locations
    const { data: locations, error: locError } = await admin
      .from("locations")
      .select("*")
      .eq("is_active", true);

    if (locError) {
      return NextResponse.json({ success: false, error: "locations fetch error: " + locError.message });
    }

    // Calculate local date range bounds
    const loc = locations?.[0];
    const opening = loc?.opening_time ?? "10:00";
    const closing = loc?.closing_time ?? "23:00";
    const [openH]  = opening.split(":").map(Number);
    const [closeH] = closing.split(":").map(Number);
    const crossesMidnight = closeH < openH;

    const fromISO = new Date(from + "T" + opening + "+05:30").toISOString();
    const toEndDate = crossesMidnight
      ? (() => { const d = new Date(to + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().split("T")[0]; })()
      : to;
    const toISO = new Date(toEndDate + "T" + closing + "+05:30").toISOString();

    // 2. Fetch orders in date range
    const { data: orders, error: ordError } = await admin
      .from("orders")
      .select(`
        id, customer_name, customer_phone, amount_due, advance_paid, subtotal, discount_amount, total_amount, points_redeemed, type, finalized_at,
        location:locations(id, name),
        items:order_items(status, rate_per_hour, actual_start, expected_end, final_amount, free_hours_to_redeem),
        payments(method, amount, status),
        extras:order_extras(price, cost_price, quantity, is_deleted)
      `)
      .eq("status", "finalized")
      .gte("finalized_at", fromISO)
      .lte("finalized_at", toISO);

    if (ordError) {
      return NextResponse.json({ success: false, error: "orders fetch error: " + ordError.message });
    }

    return NextResponse.json({
      success: true,
      locationsCount: locations?.length,
      ordersCount: orders?.length,
      fromISO,
      toISO,
      firstOrder: orders?.[0] || null
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message });
  }
}
