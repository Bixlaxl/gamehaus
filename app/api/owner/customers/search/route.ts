import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });
    }

    const { data: viewer } = await supabase
      .from("users")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (!viewer || viewer.role !== "owner") {
      return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();

    if (!q) {
      return NextResponse.json(ok([]));
    }

    const admin = createAdminClient();

    // Escape special wildcard characters
    const escaped = q.replace(/[%_]/g, "\\$&");

    const { data, error } = await admin
      .from("customer_profiles")
      .select("id, phone, name, visit_count, total_spent, points_balance, last_visit_at")
      .or(`name.ilike.%${escaped}%,phone.like.%${escaped}%`)
      .order("last_visit_at", { ascending: false, nullsFirst: false })
      .limit(20);

    if (error) {
      return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
    }

    return NextResponse.json(ok(data ?? []));
  } catch (error: any) {
    return NextResponse.json(err(error?.message || "Internal server error", "INTERNAL_ERROR"), {
      status: 500,
    });
  }
}
