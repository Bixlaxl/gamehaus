import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tableSchema, ok, err } from "@/lib/validators/schemas";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = tableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tables")
    .insert(parsed.data)
    .select()
    .single();

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok(data));
}
