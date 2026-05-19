import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';


export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; extraId: string }> }
) {
  const { extraId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("order_extras")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", extraId);

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  return NextResponse.json(ok({ deleted: true }));
}
