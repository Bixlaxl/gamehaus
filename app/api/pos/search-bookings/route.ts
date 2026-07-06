import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

/**
 * Check-in slider feed.
 *
 * Behaviour:
 *   - Empty `q` → return ALL today + tomorrow confirmed bookings at this
 *     location, ordered by start time. The slider is small enough that
 *     showing the full list as the default is more useful than forcing the
 *     staff to type something to discover bookings exist.
 *   - With `q` → narrow that list by case-insensitive substring match on
 *     customer name OR phone.
 *
 * Why admin client: RLS on bookings is restrictive for anon, so the
 * previous browser-side query silently returned []. Same pattern as the
 * other /api/pos/* feeds.
 *
 * Why IST-aware date window: Edge runtime is UTC. setHours() / new Date()
 * in UTC can cut off late-night IST traffic (e.g. a midnight-IST booking
 * is "tomorrow" in UTC). We resolve "today" in IST explicitly.
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

  // ── IST-anchored 2-day window ────────────────────────────────────────────
  // Shift "now" into IST so getUTC* reads IST clock components, then build
  // the UTC ms of IST midnight today and +2 days from there.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowMs   = Date.now();
  const nowIst  = new Date(nowMs + IST_OFFSET_MS);
  const y       = nowIst.getUTCFullYear();
  const mo      = nowIst.getUTCMonth();
  const d       = nowIst.getUTCDate();
  const dayStartMs = Date.UTC(y, mo, d, 0, 0, 0) - IST_OFFSET_MS;       // IST today 00:00
  const dayEndMs   = dayStartMs + 2 * 24 * 60 * 60 * 1000;              // +2 days

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select("*, order:orders!inner(customer_name, customer_phone, location_id, type, status, advance_paid, created_by)")
    .eq("status", "confirmed")
    .eq("orders.location_id", locationId)
    .gte("scheduled_start", new Date(dayStartMs).toISOString())
    .lt("scheduled_start",  new Date(dayEndMs).toISOString())
    .order("scheduled_start", { ascending: true });

  if (error) {
    return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  }

  // Filter out unpaid online bookings
  const rows = (data ?? []).filter((b: any) => {
    const o = b.order;
    if (o && o.type === "online" && (o.advance_paid ?? 0) === 0 && o.status === "open" && !o.created_by) {
      return false;
    }
    return true;
  });
  if (!q) {
    return NextResponse.json(ok(rows));
  }

  const term = q.toLowerCase();
  const filtered = rows.filter((b) => {
    const o = b.order as { customer_name?: string; customer_phone?: string | null } | null;
    if (!o) return false;
    return (
      (o.customer_name ?? "").toLowerCase().includes(term) ||
      (o.customer_phone ?? "").includes(term)
    );
  });

  return NextResponse.json(ok(filtered));
}
