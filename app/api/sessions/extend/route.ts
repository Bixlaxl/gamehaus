import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extendSessionSchema, ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';
export const dynamic = "force-dynamic";


// No buffer — the gap from a session's expected_end to the next booking's
// scheduled_start is fully usable as extend time. (Staff judgement decides
// table-turnover practicality.)
const BUFFER_MINS = 0;

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
    .select("*, table:tables(location:locations(opening_time, closing_time))")
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
  const openingTime = (item.table as { location: { opening_time: string; closing_time: string } | null } | null)?.location?.opening_time;
  const closingTime = (item.table as { location: { opening_time: string; closing_time: string } | null } | null)?.location?.closing_time;
  if (openingTime && closingTime) {
    const [oh, om] = openingTime.split(":").map(Number);
    const [ch, cm] = closingTime.split(":").map(Number);
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowMs  = Date.now();
    const nowIst = new Date(nowMs + IST_OFFSET_MS);
    const y = nowIst.getUTCFullYear();
    const mo = nowIst.getUTCMonth();
    const d = nowIst.getUTCDate();
    const opensUtc  = Date.UTC(y, mo, d, oh, om) - IST_OFFSET_MS;
    const closesUtc = Date.UTC(y, mo, d, ch, cm) - IST_OFFSET_MS;
    const crossesMidnight = (ch * 60 + cm) <= (oh * 60 + om);

    let closesMs: number;
    if (!crossesMidnight) {
      closesMs = closesUtc;
    } else {
      const nowMinsIst = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes();
      const closeMins  = ch * 60 + cm;
      if (nowMinsIst < closeMins) {
        closesMs = closesUtc;
      } else {
        closesMs = closesUtc + 24 * 60 * 60 * 1000;
      }
    }

    if (newExpectedEnd.getTime() > closesMs) {
      const maxMins = Math.max(0, Math.floor((closesMs - anchor.getTime()) / 60000));
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
          `Cannot extend — there is a next booking in ${Math.ceil((nextStart.getTime() - Date.now()) / 60000)} mins`,
          "EXTEND_BLOCKED"
        ),
        { status: 409 }
      );
    }

    if (extend_mins > maxExtendMins) {
      return NextResponse.json(
        err(
          `Only ${maxExtendMins} mins available before the next booking`,
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
