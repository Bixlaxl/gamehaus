import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err, friendlyDbError, updateInventoryItemSchema } from "@/lib/validators/schemas";

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
  const parsed = updateInventoryItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.issues[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("inventory_items")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  return NextResponse.json(ok(data));
}

/**
 * DELETE inventory item.
 *
 * Default: soft delete (sets is_active = false). Safe — preserves the row
 * so historical order_extras references stay intact.
 *
 * With ?permanent=true: hard delete. Will be blocked by Postgres if any
 * order_extras row references this item (FK constraint). The friendly
 * error tells the owner to deactivate instead in that case.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const permanent = new URL(request.url).searchParams.get("permanent") === "true";
  const admin = createAdminClient();

  if (permanent) {
    const { error } = await admin.from("inventory_items").delete().eq("id", id);
    if (error) {
      const f = friendlyDbError(error, { entity: "inventory item" });
      const status = f.code === "FK_CONSTRAINT" ? 409 : 500;
      return NextResponse.json(err(f.message, f.code), { status });
    }
    return NextResponse.json(ok({ deleted: true }));
  }

  const { error } = await admin
    .from("inventory_items")
    .update({ is_active: false })
    .eq("id", id);

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  return NextResponse.json(ok({ deactivated: true }));
}
