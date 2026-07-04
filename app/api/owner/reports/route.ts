import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { data: viewer } = await supabase
    .from("users")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (!viewer || viewer.role !== "owner") {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json(err("from and to are required", "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch locations
  const { data: locations, error: locError } = await admin
    .from("locations")
    .select("*");
  if (locError) return NextResponse.json(err(locError.message, "DB_ERROR"), { status: 500 });

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

  // Fetch orders in date range
  const { data: orders, error: ordError } = await admin
    .from("orders")
    .select(`
      id, customer_name, customer_phone, amount_due, advance_paid, subtotal, discount_amount, public_discount_amount, total_amount, points_redeemed, type, finalized_at,
      location:locations(id, name),
      items:order_items(status, rate_per_hour, actual_start, expected_end, final_amount, free_hours_to_redeem),
      payments(method, amount, status),
      extras:order_extras(price, cost_price, quantity, is_deleted)
    `)
    .eq("status", "finalized")
    .gte("finalized_at", fromISO)
    .lte("finalized_at", toISO)
    .limit(50000);

  if (ordError) return NextResponse.json(err(ordError.message, "DB_ERROR"), { status: 500 });

  // Fetch 6 months history
  const today = new Date();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(today.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const histFromISO = new Date(sixMonthsAgo.toISOString().split("T")[0] + "T" + opening + "+05:30").toISOString();

  const { data: history, error: histError } = await admin
    .from("orders")
    .select(`
      id, amount_due, advance_paid, finalized_at, location_id,
      location:locations(id, name)
    `)
    .eq("status", "finalized")
    .gte("finalized_at", histFromISO)
    .order("finalized_at", { ascending: true })
    .limit(50000);

  if (histError) return NextResponse.json(err(histError.message, "DB_ERROR"), { status: 500 });

  // Fetch customer memberships assigned in the last 6 months (matching the history range)
  // Use full-day IST boundaries (midnight start, end-of-day end) so that
  // membership created_at (UTC wall clock) is captured regardless of business hours.
  const membHistFromISO = new Date(sixMonthsAgo.toISOString().split("T")[0] + "T00:00:00+05:30").toISOString();
  const membToISO   = new Date(to   + "T23:59:59+05:30").toISOString();

  const { data: memberships, error: membError } = await admin
    .from("customer_memberships")
    .select(`
      id, customer_phone, starts_at, created_at,
      plan:membership_plans(id, name, price)
    `)
    .gte("created_at", membHistFromISO)
    .lte("created_at", membToISO)
    .limit(50000);

  if (membError) return NextResponse.json(err(membError.message, "DB_ERROR"), { status: 500 });

  return NextResponse.json(ok({
    locations: locations ?? [],
    orders: orders ?? [],
    history: history ?? [],
    memberships: memberships ?? [],
  }));
}
