import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { order_item_id } = body;
  if (!order_item_id) {
    return NextResponse.json(err("order_item_id is required", "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();

  const { data: item, error: itemError } = await admin
    .from("order_items")
    .select("*")
    .eq("id", order_item_id)
    .single();

  if (itemError || !item) {
    return NextResponse.json(err("Order item not found", "NOT_FOUND"), { status: 404 });
  }

  if (item.status !== "running" && item.status !== "finished") {
    return NextResponse.json(err("Session is not in a reversible state", "INVALID_STATE"), { status: 400 });
  }

  const startReal = item.actual_start || item.checked_in_at;
  if (!startReal) {
    return NextResponse.json(err("Session has not started yet", "INVALID_STATE"), { status: 400 });
  }

  const durationMins = item.scheduled_duration_mins || 60;
  const originalExpectedEnd = new Date(new Date(startReal).getTime() + durationMins * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("order_items")
    .update({
      expected_end: originalExpectedEnd,
      extended_mins: 0,
    })
    .eq("id", order_item_id)
    .select();

  if (error) {
    return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
  }

  return NextResponse.json(ok(data[0]));
}
