import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ok, err, friendlyDbError } from "@/lib/validators/schemas";

export const runtime = "edge";

async function requireOwner() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false as const, status: 401, body: err("Unauthorized", "UNAUTHORIZED") };
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (profile?.role !== "owner") {
    return { ok: false as const, status: 403, body: err("Forbidden", "FORBIDDEN") };
  }
  return { ok: true as const };
}

/**
 * Toggle is_active on a staff member.
 *
 * Previously the owner UI was writing this directly via the browser Supabase
 * client (anon role). Depending on RLS that silently failed and the optimistic
 * cache drifted out of sync with the DB. Route it through the admin client.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOwner();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const { id } = await params;
  const body = await request.json() as { is_active?: boolean };
  if (typeof body.is_active !== "boolean") {
    return NextResponse.json(err("is_active boolean is required", "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .update({ is_active: body.is_active })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    const f = friendlyDbError(error, { entity: "staff" });
    return NextResponse.json(err(f.message, f.code), { status: 500 });
  }
  return NextResponse.json(ok(data));
}

/**
 * Permanently delete a staff member — removes the public.users profile AND
 * the auth.users row. Blocked by Postgres if the staff member has any
 * orders.created_by referencing them; the friendly error message tells the
 * owner to deactivate instead.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireOwner();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const { id } = await params;
  const admin = createAdminClient();

  // 1. public.users first — if FK fails here, we haven't touched auth.users yet
  const { error: dbError } = await admin.from("users").delete().eq("id", id);
  if (dbError) {
    const f = friendlyDbError(dbError, { entity: "staff" });
    return NextResponse.json(err(f.message, f.code), { status: 409 });
  }

  // 2. auth.users — if this fails we have an orphan profile gone, auth row left.
  //    Rare; surface the raw message so it's debuggable.
  const { error: authError } = await admin.auth.admin.deleteUser(id);
  if (authError) {
    return NextResponse.json(err(authError.message, "AUTH_ERROR"), { status: 500 });
  }

  return NextResponse.json(ok({ deleted: true }));
}
