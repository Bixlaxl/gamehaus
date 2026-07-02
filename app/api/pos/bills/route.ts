import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Staff bills feed — every finalized order at this staff member's location,
 * newest first, with items + extras + payments joined for the detail modal.
 *
 * Pagination: 100 most recent per fetch is fine for normal cafe volume
 * (~30-50 bills/day), so a simple limit + offset query covers it without
 * a real cursor. Owner panel has the full reports for deeper analytics.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const admin = createAdminClient();
  const { data: viewer } = await admin
    .from("users").select("role, location_id").eq("id", session.user.id).single();
  if (!viewer) return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });

  const { searchParams } = new URL(request.url);
  const q       = (searchParams.get("q") ?? "").trim().toLowerCase();
  const limit   = Math.min(200, Math.max(10, parseInt(searchParams.get("limit") ?? "100")));
  const offset  = Math.max(0, parseInt(searchParams.get("offset") ?? "0"));

  // Staff = scoped to their own location. Owner can pass ?location_id=
  // explicitly if they ever want to view this feed (otherwise sees all).
  const locationParam = searchParams.get("location_id");
  const effectiveLocation = viewer.role === "staff" ? viewer.location_id : locationParam;

  let query = admin
    .from("orders")
    .select(`
      id, location_id, type, customer_name, customer_phone, status,
      subtotal, discount_amount, public_discount_amount, total_amount, amount_due, advance_paid, points_redeemed,
      finalized_at, created_at,
      items:order_items(id, table_id, status, actual_start, actual_end, expected_end, rate_per_hour, final_amount, num_people, table:tables(name, type)),
      extras:order_extras(id, name, price, quantity, is_deleted),
      payments(id, amount, method, status, collected_at)
    `)
    .eq("status", "finalized")
    .order("finalized_at", { ascending: false })
    .limit(limit)
    .range(offset, offset + limit - 1);

  if (effectiveLocation) query = query.eq("location_id", effectiveLocation);

  const { data, error } = await query;
  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  // Filter out hollow imported historical orders (which have neither table sessions nor inventory extras)
  const nonHollowRows = (data ?? []).filter(
    (o) => (o.items && o.items.length > 0) || (o.extras && o.extras.length > 0)
  );

  // Filter by name/phone if query parameter is set
  const rows = q
    ? nonHollowRows.filter((o) => {
        const name  = (o.customer_name  ?? "").toLowerCase();
        const phone = (o.customer_phone ?? "");
        return name.includes(q) || phone.includes(q);
      })
    : nonHollowRows;

  return NextResponse.json(ok(rows));
}
