import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err, updateMembershipPlanSchema } from "@/lib/validators/schemas";

export const runtime = "edge";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body = await request.json() as unknown;
  const parsed = updateMembershipPlanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.issues[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("membership_plans")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data));
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("membership_plans")
    .delete()
    .eq("id", id);

  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        err("Cannot permanently delete — this plan is assigned to customers. Deactivate it instead.", "FK_CONSTRAINT"),
        { status: 400 }
      );
    }
    return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  }
  return NextResponse.json(ok({ deleted: true }));
}
