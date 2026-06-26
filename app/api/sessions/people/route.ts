import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setPeopleSchema, ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Change the player / controller count on a running order_item.
 *
 * Why server-side rate resolution: the client could pass any number, so we
 * re-derive `rate_per_hour` from `tables.people_pricing` here. If the table
 * has no people_pricing entry for the new count, we fall back to the table's
 * flat `hourly_rate` so the staff can still record the count (e.g. customer
 * brought 7 friends, no tier exists yet — rate stays at the flat default).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = setPeopleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { order_item_id, num_people } = parsed.data;
  const admin = createAdminClient();

  const { data: item, error: itemErr } = await admin
    .from("order_items")
    .select("id, table_id, status")
    .eq("id", order_item_id)
    .single();

  if (itemErr || !item) {
    return NextResponse.json(err("Order item not found", "NOT_FOUND"), { status: 404 });
  }
  if (item.status === "finished" || item.status === "cancelled") {
    return NextResponse.json(err("Cannot change people count on a closed session", "INVALID_STATE"), { status: 400 });
  }

  const { data: table, error: tableErr } = await admin
    .from("tables")
    .select("name, type, hourly_rate, people_pricing")
    .eq("id", item.table_id)
    .single();

  if (tableErr || !table) {
    return NextResponse.json(err("Table not found", "NOT_FOUND"), { status: 404 });
  }

  const isSimulator = table.type === "ps5" && table.name.toLowerCase().includes("simulator");
  const pp = (table.people_pricing ?? {}) as Record<string, number>;
  const tieredRate = pp[String(num_people)];
  let newRate = typeof tieredRate === "number" && tieredRate > 0
    ? tieredRate
    : table.hourly_rate;

  if (isSimulator && !pp[String(num_people)] && num_people === 2) {
    newRate = table.hourly_rate * 2;
  }

  const { error: updateErr } = await admin
    .from("order_items")
    .update({ num_people, rate_per_hour: newRate })
    .eq("id", order_item_id);

  if (updateErr) {
    return NextResponse.json(err(updateErr.message, "DB_ERROR"), { status: 500 });
  }

  return NextResponse.json(ok({ num_people, rate_per_hour: newRate }));
}
