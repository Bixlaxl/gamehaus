import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';

/**
 * GET — owner-only list of every location (active + inactive).
 *
 * The /owner/locations page used to query Supabase directly from the
 * browser, which hits RLS — and any location the anon-like role can't
 * read silently disappeared from the list. Same reason /owner/tables had
 * the same problem. Admin client here bypasses RLS so the owner always
 * sees the real, full set.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { data: viewer } = await supabase
    .from("users").select("role").eq("id", session.user.id).single();
  if (viewer?.role !== "owner" && viewer?.role !== "staff") {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("locations")
    .select("*")
    .order("created_at");
  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data ?? []));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body = await request.json();
  const admin = createAdminClient();
  const { data, error } = await admin.from("locations").insert(body).select().single();
  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data));
}
