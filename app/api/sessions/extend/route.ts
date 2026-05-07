import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extendSessionSchema, ok, err } from "@/lib/validators/schemas";

const BUFFER_MINS = 10;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = extendSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { order_item_id, extend_mins } = parsed.data;

  const { data: item, error: itemError } = await supabase
    .from("order_items")
    .select("*")
    .eq("id", order_item_id)
    .single();

  if (itemError || !item) {
    return NextResponse.json(err("Order item not found", "NOT_FOUND"), { status: 404 });
  }

  if (item.status !== "running") {
    return NextResponse.json(err("Can only extend a running session", "INVALID_STATE"), { status: 400 });
  }

  const currentExpectedEnd = item.expected_end
    ? new Date(item.expected_end)
    : new Date();

  const newExpectedEnd = new Date(
    currentExpectedEnd.getTime() + extend_mins * 60 * 1000
  );

  // Check for confirmed online bookings on this table that would conflict (10-min buffer)
  const bufferTime = new Date(newExpectedEnd.getTime() + BUFFER_MINS * 60 * 1000);

  const { data: conflictingBookings } = await supabase
    .from("bookings")
    .select(`
      id,
      scheduled_start,
      order:orders(customer_name),
      order_item:order_items!inner(table_id)
    `)
    .eq("status", "confirmed")
    .lt("scheduled_start", bufferTime.toISOString())
    .gt("scheduled_start", new Date().toISOString());

  const conflicts = (conflictingBookings ?? []).filter(
    (b) => (b.order_item as { table_id: string }).table_id === item.table_id
  );

  if (conflicts.length > 0) {
    const nextBooking = conflicts[0];
    const nextStart = new Date(nextBooking.scheduled_start);
    const latestAllowed = new Date(nextStart.getTime() - BUFFER_MINS * 60 * 1000);
    const maxExtendMins = Math.floor(
      (latestAllowed.getTime() - currentExpectedEnd.getTime()) / 60000
    );

    if (maxExtendMins <= 0) {
      return NextResponse.json(
        err(
          `Cannot extend — next booking in ${Math.ceil((nextStart.getTime() - Date.now()) / 60000)} mins (${BUFFER_MINS}-min buffer required)`,
          "EXTEND_BLOCKED"
        ),
        { status: 409 }
      );
    }

    if (extend_mins > maxExtendMins) {
      return NextResponse.json(
        err(
          `Only ${maxExtendMins} mins available before next booking (${BUFFER_MINS}-min buffer required)`,
          "EXTEND_PARTIAL"
        ),
        { status: 409 }
      );
    }
  }

  const { error: updateError } = await supabase
    .from("order_items")
    .update({
      expected_end: newExpectedEnd.toISOString(),
      extended_mins: item.extended_mins + extend_mins,
    })
    .eq("id", order_item_id);

  if (updateError) {
    return NextResponse.json(err(updateError.message, "DB_ERROR"), { status: 500 });
  }

  return NextResponse.json(
    ok({
      new_expected_end: newExpectedEnd.toISOString(),
      message: `Session extended by ${extend_mins} mins`,
    })
  );
}
