import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tableSchema, ok, err } from "@/lib/validators/schemas";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { id } = await params;
  const body: unknown = await request.json();
  const parsed = tableSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tables")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { id } = await params;
  const admin = createAdminClient();
  const { error } = await admin
    .from("tables")
    .update({ is_active: false })
    .eq("id", id);

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok({ id }));
}
