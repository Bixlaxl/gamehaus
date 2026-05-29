import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err, friendlyDbError } from "@/lib/validators/schemas";

export const runtime = 'edge';


export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const admin = createAdminClient();
  const { data, error } = await admin.from("locations").update(body).eq("id", id).select().single();
  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { id } = await params;
  const permanent = new URL(request.url).searchParams.get("permanent") === "true";
  const admin = createAdminClient();

  if (permanent) {
    const { error } = await admin.from("locations").delete().eq("id", id);
    if (error) {
      const f = friendlyDbError(error, { entity: "location" });
      // 409 Conflict for FK violations — semantically "you can do this, but not while it has dependents"
      const status = f.code === "FK_CONSTRAINT" ? 409 : 500;
      return NextResponse.json(err(f.message, f.code), { status });
    }
  } else {
    const { error } = await admin.from("locations").update({ is_active: false }).eq("id", id);
    if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  }

  return NextResponse.json(ok({ id }));
}
