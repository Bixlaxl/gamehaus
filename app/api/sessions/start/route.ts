import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { startSessionSchema, ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';
export const dynamic = "force-dynamic";


export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = startSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { order_item_id } = parsed.data;
  const admin = createAdminClient();

  // Fetch the order item
  const { data: item, error: itemError } = await admin
    .from("order_items")
    .select("*, order:orders(type)")
    .eq("id", order_item_id)
    .single();

  if (itemError || !item) {
    return NextResponse.json(err("Order item not found", "NOT_FOUND"), { status: 404 });
  }

  if (item.status !== "scheduled") {
    return NextResponse.json(err("Session is not in scheduled state", "INVALID_STATE"), { status: 400 });
  }

  if (item.scheduled_start) {
    const start = new Date(item.scheduled_start);
    const nowTime = new Date();
    const maxEarlyStartMs = 45 * 60 * 1000;
    if (start.getTime() - nowTime.getTime() > maxEarlyStartMs) {
      return NextResponse.json(
        err("Session cannot be started more than 45 minutes before its scheduled start time. Reschedule if they want to play now.", "TOO_EARLY"),
        { status: 400 }
      );
    }
  }

  const now = new Date().toISOString();
  const order = item.order as { type: string } | null;

  // Calculate expected_end
  // Walk-in: duration from now (no scheduled slot to anchor to)
  // Online: respect scheduled_end — late arrival loses that time, overtime when exceeded
  let expectedEnd: string | null = null;
  if (order?.type === "walk_in" && item.scheduled_duration_mins) {
    const end = new Date(Date.now() + item.scheduled_duration_mins * 60 * 1000);
    expectedEnd = end.toISOString();
  } else if (item.scheduled_end) {
    expectedEnd = item.scheduled_end;
  }

  const { error: updateError } = await admin
    .from("order_items")
    .update({
      status: "running",
      actual_start: now,
      expected_end: expectedEnd,
    })
    .eq("id", order_item_id);

  if (updateError) {
    return NextResponse.json(err(updateError.message, "DB_ERROR"), { status: 500 });
  }

  return NextResponse.json(ok({ started_at: now }));
}
