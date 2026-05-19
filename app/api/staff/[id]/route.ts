import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';


export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "owner") {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  const { id } = params;
  const admin = createAdminClient();

  // Delete from public.users first (FK constraint)
  const { error: dbError } = await admin.from("users").delete().eq("id", id);
  if (dbError) return NextResponse.json(err(dbError.message, "DB_ERROR"), { status: 500 });

  // Delete auth user
  const { error: authError } = await admin.auth.admin.deleteUser(id);
  if (authError) return NextResponse.json(err(authError.message, "AUTH_ERROR"), { status: 500 });

  return NextResponse.json(ok({ deleted: true }));
}
