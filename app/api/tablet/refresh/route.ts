import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

export async function POST(request: Request) {
  const body = await request.json() as any;
  const { refresh_token } = body;
  if (!refresh_token) {
    return NextResponse.json(err("Refresh token required", "VALIDATION_ERROR"), { status: 400 });
  }

  const { createServerClient } = await import("@supabase/ssr");
  const cleanClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    }
  );

  const { data, error } = await cleanClient.auth.refreshSession({
    refresh_token
  });

  if (error || !data.session || !data.user) {
    return NextResponse.json(err(error?.message || "Token refresh failed", "AUTH_ERROR"), { status: 401 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role, location_id")
    .eq("id", data.user.id)
    .single();

  if (!profile || (profile.role !== "owner" && profile.role !== "staff")) {
    await cleanClient.auth.signOut();
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
