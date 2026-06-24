import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

export async function POST(request: Request) {
  const body = await request.json() as any;
  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json(err("Email and password required", "VALIDATION_ERROR"), { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    return NextResponse.json(err(error?.message || "Login failed", "AUTH_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role, location_id")
    .eq("id", data.user.id)
    .single();

  if (!profile || (profile.role !== "owner" && profile.role !== "staff")) {
    await supabase.auth.signOut();
    return NextResponse.json(err("Forbidden: Kiosk requires staff/owner role", "FORBIDDEN"), { status: 403 });
  }

  return NextResponse.json(ok({
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: {
      id: data.user.id,
      email: data.user.email,
      role: profile.role,
      location_id: profile.location_id
    }
  }));
}
