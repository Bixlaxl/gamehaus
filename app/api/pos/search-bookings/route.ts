import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

/**
 * Check-in slider search.
 *
 * Why this exists as an API instead of a browser-client Supabase query:
 *   RLS on the bookings table is restrictive for the anon role, so the
 *   previous browser-side query silently returned [] (no error, just no
 *   rows). This route uses the admin client to bypass RLS — same pattern
 *   as the other /api/pos/* feeds.
 *
 * Window: today + tomorrow. Covers same-day check-ins and the common
 * "I'm here for my booking tonight but the date already rolled over"
 * post-midnight edge case.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { searchParams } = new URL(request.url);
  const q          = (searchParams.get("q") ?? "").trim();
  const locationId = searchParams.get("locationId");

  if (!locationId) {
    return NextResponse.json(err("locationId required", "VALIDATION_ERROR"), { status: 400 });
  }
  if (!q) {
    return NextResponse.json(ok([]));
  }

  const admin = createAdminClient();
  const now      = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd   = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 2);

  const { data, error } = await admin
    .from("bookings")
    .select("*, order:orders!inner(customer_name, customer_phone, location_id)")
    .eq("status", "confirmed")
    .eq("orders.location_id", locationId)
    .gte("scheduled_start", dayStart.toISOString())
    .lt("scheduled_start", dayEnd.toISOString())
    .order("scheduled_start", { ascending: true });

  if (error) {
    return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  }

  // Filter by name/phone client-side on the server — small result set per location/2-day window
  const term = q.toLowerCase();
  const filtered = (data ?? []).filter((b) => {
    const o = b.order as { customer_name: string; customer_phone: string | null } | null;
    if (!o) return false;
    return (
      o.customer_name.toLowerCase().includes(term) ||
      (o.customer_phone ?? "").includes(term)
    );
  });

  return NextResponse.json(ok(filtered));
}
