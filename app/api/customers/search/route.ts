import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

/**
 * Customer name autocomplete for the POS walk-in panel.
 *
 * Prefix-matches `customer_profiles.name` (case-insensitive), returns up to 5
 * candidates so staff can disambiguate when two customers share a first name.
 *
 * Backed by `idx_customer_profiles_lower_name` (see MIGRATIONS.sql) — without
 * that index every keystroke would full-scan the customer_profiles table.
 */
const MAX_RESULTS = 5;
const MIN_QUERY_LEN = 2;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (q.length < MIN_QUERY_LEN) {
    return NextResponse.json(ok([]));
  }

  const admin = createAdminClient();

  // ilike pattern — Postgres planner uses the lower(name) text_pattern_ops
  // index for prefix queries. The trailing % means "starts-with".
  // Escape % and _ in the user input so they don't act as wildcards.
  const escaped = q.replace(/[%_]/g, "\\$&");

  const { data, error } = await admin
    .from("customer_profiles")
    .select("phone, name, visit_count, points_balance")
    .ilike("name", `${escaped}%`)
    .not("name", "is", null)
    .order("visit_count", { ascending: false })
    .limit(MAX_RESULTS);

  if (error) {
    return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  }

  return NextResponse.json(ok(data ?? []));
}
