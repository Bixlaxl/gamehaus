import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

/**
 * Customer autocomplete for the POS walk-in panel — name OR phone prefix.
 *
 * Detection rule: if the query is purely digits, search phone prefix.
 * Otherwise, search name prefix (case-insensitive). Returns up to 5
 * candidates so staff can disambiguate when two customers share a
 * first name OR when only a partial phone is typed.
 *
 * Backed by:
 *   idx_customer_profiles_lower_name        (name prefix)
 *   idx_customer_profiles_phone_prefix      (phone prefix)
 * Both are text_pattern_ops B-tree indexes — see MIGRATIONS.sql.
 */
const MAX_RESULTS = 5;
const MIN_NAME_LEN  = 2;
const MIN_PHONE_LEN = 3;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (!q) return NextResponse.json(ok([]));

  const admin = createAdminClient();
  const isPhone = /^\d+$/.test(q);

  // Escape ilike-meta chars so they aren't interpreted as wildcards
  const escaped = q.replace(/[%_]/g, "\\$&");

  if (isPhone) {
    if (q.length < MIN_PHONE_LEN) return NextResponse.json(ok([]));

    const { data, error } = await admin
      .from("customer_profiles")
      .select("phone, name, visit_count, points_balance")
      .like("phone", `${escaped}%`)
      .order("visit_count", { ascending: false })
      .limit(MAX_RESULTS);

    if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
    return NextResponse.json(ok(data ?? []));
  }

  // Name prefix search
  if (q.length < MIN_NAME_LEN) return NextResponse.json(ok([]));

  const { data, error } = await admin
    .from("customer_profiles")
    .select("phone, name, visit_count, points_balance")
    .ilike("name", `${escaped}%`)
    .not("name", "is", null)
    .order("visit_count", { ascending: false })
    .limit(MAX_RESULTS);

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data ?? []));
}
