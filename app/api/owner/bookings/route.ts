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
 * Owner-side bookings list for /owner/bookings.
 *
 * Why this exists as an admin-backed API instead of a browser-client Supabase
 * query: RLS on bookings (and the joined orders/order_items/tables/locations)
 * is restrictive for the anon role. The previous in-page browser query
 * silently returned [] when the date changed, which is what made it look like
 * "the bookings don't appear until I reload". The server-rendered initial
 * fetch worked because it uses the admin client; the client refetch didn't.
 *
 * Returns bookings whose scheduled_start falls between ?from and ?to,
 * with the same joined shape the page renders.
 */
export async function GET(request: Request) {
  // Owner-only — re-verify the session here so we can't be hit anonymously
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { data: viewer } = await supabase
    .from("users")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (viewer?.role !== "owner") {
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
      order:orders(customer_name, customer_phone, advance_paid),
      order_item:order_items(table:tables(name, type, location:locations(name, id)))
    `)
    .gte("scheduled_start", from)
    .lte("scheduled_start", to)
    .order("scheduled_start");

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data ?? []));
}
