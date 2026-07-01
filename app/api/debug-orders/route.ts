import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data: orders, error } = await supabase
      .from("orders")
      .select(`
        id, status, amount_due, advance_paid,
        items:order_items(id, status, rate_per_hour, final_amount, actual_start, expected_end, scheduled_start, scheduled_end),
        payments(method, amount, status),
        extras:order_extras(price, cost_price, quantity, is_deleted)
      `)
      .eq("status", "finalized");

    if (error) {
      return NextResponse.json({ success: false, error: error.message });
    }
    return NextResponse.json({ success: true, orders });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message });
  }
}
