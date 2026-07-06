import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";
// Force dynamic — this is a date-windowed query that changes constantly.
// Without this, Next.js may cache the response per URL and serve stale
// data on a revisit to the same date.
export const dynamic = "force-dynamic";

/**
 * Owner-side bookings list. Also reachable from the staff bookings page
 * (`/pos/bookings`), in which case results are auto-scoped to the staff
 * member's own location.
 *
 * Returns bookings whose scheduled_start falls between ?from and ?to,
 * with the joined shape used by both BookingsContent variants.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { data: viewer } = await supabase
    .from("users")
    .select("role, location_id")
    .eq("id", session.user.id)
    .single();
  if (!viewer || (viewer.role !== "owner" && viewer.role !== "staff")) {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json(err("from and to are required", "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select(`
      *,
      order:orders(customer_name, customer_phone, advance_paid, type, status, created_by, order_items(id, status)),
      order_item:order_items(table:tables(name, type, location:locations(name, id)))
    `)
    .gte("scheduled_start", from)
    .lte("scheduled_start", to)
    .order("scheduled_start");

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  // Filter out unpaid online bookings
  const rows = (data ?? []).filter((b: any) => {
    const o = b.order;
    if (o && o.type === "online" && (o.advance_paid ?? 0) === 0 && o.status === "open" && !o.created_by) {
      return false;
    }
    return true;
  });
  const filtered = viewer.role === "staff" && viewer.location_id
    ? rows.filter((b) => {
        const t = (b.order_item as { table?: { location?: { id?: string } } } | null)?.table;
        return t?.location?.id === viewer.location_id;
      })
    : rows;

  return NextResponse.json(ok(filtered));
}
