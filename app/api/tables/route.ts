import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tableSchema, ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';

/**
 * GET — owner-only list of every table across all locations.
 * Optional ?location_id filters to one location.
 *
 * Same RLS-bypass reasoning as /api/locations: the /owner/tables page used
 * to query Supabase directly from the browser, so tables at locations the
 * anon role couldn't read silently disappeared. Routing through admin here
 * ensures the owner sees the real, full set.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { data: viewer } = await supabase
    .from("users").select("role, location_id").eq("id", session.user.id).single();
  if (!viewer || (viewer.role !== "owner" && viewer.role !== "staff")) {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedLocation = searchParams.get("location_id");

  // Staff is scoped to their own location regardless of what they ask for.
  // Owner can request any location or all locations.
  const effectiveLocation = viewer.role === "staff"
    ? viewer.location_id
    : requestedLocation;

  const admin = createAdminClient();
  let query = admin
    .from("tables")
    .select("*")
    .order("sort_order");
  if (effectiveLocation) query = query.eq("location_id", effectiveLocation);

  const { data, error } = await query;
  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data ?? []));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = tableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tables")
    .insert(parsed.data as any)
    .select()
    .single();

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data));
}
