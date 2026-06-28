import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

export async function GET() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const admin = createAdminClient();
  const now   = new Date().toISOString();

  const { data: assignments, error } = await admin
    .from("customer_memberships")
    .select(`*, plan:membership_plans(*)`)
    .eq("is_active", true)
    .gte("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  const list = assignments ?? [];

  // Enrich with customer names from profiles
  const phones = Array.from(new Set(list.map((a) => a.customer_phone)));
  let profiles: Array<{ phone: string; name: string | null }> = [];
  if (phones.length > 0) {
    const { data: profs } = await admin
      .from("customer_profiles")
      .select("phone, name")
      .in("phone", phones);
    profiles = profs ?? [];
  }

  const enriched = list.map((a) => {
    const profile = profiles.find((p) => p.phone === a.customer_phone);
    return {
      ...a,
      customer_name: profile?.name ?? "Unknown",
    };
  });

  return NextResponse.json(ok(enriched));
}
