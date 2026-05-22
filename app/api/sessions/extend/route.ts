import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extendSessionSchema, ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';


const BUFFER_MINS = 10;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = extendSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { order_item_id, extend_mins } = parsed.data;
  const admin = createAdminClient();

  const { data: item, error: itemError } = await admin
    .from("order_items")
    .select("*, table:tables(location:locations(closing_time))")
    .eq("id", order_item_id)
    .single();

  if (itemError || !item) {
    return NextResponse.json(err("Order item not found", "NOT_FOUND"), { status: 404 });
  }

  if (item.status !== "running" && item.status !== "finished") {
    return NextResponse.json(err("Session is not in an extendable state", "INVALID_STATE"), { status: 400 });
  }

  // Always anchor extension to expected_end — never to "now" — so brief staff
  // delays after the session ends don't shrink the customer's add-on time.
  const anchor = item.expected_end ? new Date(item.expected_end) : new Date();
  const newExpectedEnd = new Date(anchor.getTime() + extend_mins * 60 * 1000);

  // Enforce shop closing time as a hard ceiling
  const closingTime = (item.table as { location: { closing_time: string } | null } | null)?.location?.closing_time;
  if (closingTime) {
    const [ch, cm] = closingTime.split(":").map(Number);
    const todayClose = new Date(anchor);
    todayClose.setHours(ch, cm, 0, 0);
    if (todayClose.getTime() < anchor.getTime() && ch < 6) {
      todayClose.setDate(todayClose.getDate() + 1);
    }
    if (newExpectedEnd.getTime() > todayClose.getTime()) {
      const maxMins = Math.max(0, Math.floor((todayClose.getTime() - anchor.getTime()) / 60000));
      return NextResponse.json(
        err(
          `Cannot extend past shop closing — only ${maxMins} mins available`,
          "PAST_CLOSING"
        ),
        { status: 409 }
      );
    }
  }

  // Check for confirmed online bookings on this table that would conflict (10-min buffer)
  const bufferTime = new Date(newExpectedEnd.getTime() + BUFFER_MINS * 60 * 1000);

  const { data: conflictingBookings } = await admin
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
      (latestAllowed.getTime() - anchor.getTime()) / 60000
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

  // Resurrect a finished session: flip status back to running, clear actual_end so
  // the bill engine recomputes against the new expected_end.
  const updatePayload: {
    expected_end: string;
    extended_mins: number;
    status?: "running";
    actual_end?: null;
  } = {
    expected_end:  newExpectedEnd.toISOString(),
    extended_mins: item.extended_mins + extend_mins,
  };
  if (item.status === "finished") {
    updatePayload.status     = "running";
    updatePayload.actual_end = null;
  }

  const { error: updateError } = await admin
    .from("order_items")
    .update(updatePayload)
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
