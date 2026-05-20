import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createStaffSchema } from "@/lib/validators/schemas";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';


export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });
  const user = session.user;

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "owner") {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  const body: unknown = await request.json();
  const parsed = createStaffSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      err(parsed.error.errors[0].message, "VALIDATION_ERROR"),
      { status: 400 }
    );
  }

  const { name, email, password, location_id } = parsed.data;
  const admin = createAdminClient();

  // Create auth user
  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authUser.user) {
    return NextResponse.json(
      err(authError?.message ?? "Failed to create user", "AUTH_ERROR"),
      { status: 400 }
    );
  }

  // Insert into public.users
  const { error: dbError } = await admin.from("users").insert({
    id: authUser.user.id,
    name,
    email,
    role: "staff",
    location_id,
    login_password: password,
  });

  if (dbError) {
    // Roll back auth user
    await admin.auth.admin.deleteUser(authUser.user.id);
    return NextResponse.json(
      err(dbError.message, "DB_ERROR"),
      { status: 500 }
    );
  }

  return NextResponse.json(ok({ id: authUser.user.id }));
}
