import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';


export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bookingId } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const admin = createAdminClient();

  // Fetch booking + location so we can both anchor the slot AND enforce that
  // check-in only happens during the location's operating hours. The
  // disabled-button on the client is a hint; this is the authoritative gate
  // so no other UI surface (per-table card, slider, manual fetch) can
  // accidentally check someone in while the shop is closed.
  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select("*, order_item:order_items(table_id, table:tables(location:locations(id, opening_time, closing_time)))")
    .eq("id", bookingId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json(err("Booking not found", "NOT_FOUND"), { status: 404 });
  }

  if (booking.status !== "confirmed") {
    return NextResponse.json(err("Booking is not in confirmed state", "INVALID_STATE"), { status: 400 });
  }

  // ── Operating-hours gate (server authoritative) ────────────────────────────
  // Edge runtime is UTC. Resolve "is the shop currently open?" in IST so a
  // 14:30 IST check-in for a 10:00–23:00 shop passes regardless of where the
  // function runs.
  const orderItem    = booking.order_item as { table?: { location?: { opening_time?: string; closing_time?: string } } } | null;
  const opening = orderItem?.table?.location?.opening_time ?? null;
  const closing = orderItem?.table?.location?.closing_time ?? null;
  if (opening && closing) {
    const [oh, om] = opening.split(":").map(Number);
    const [ch, cm] = closing.split(":").map(Number);
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowMs  = Date.now();
    const nowIst = new Date(nowMs + IST_OFFSET_MS);
    const y = nowIst.getUTCFullYear();
    const mo = nowIst.getUTCMonth();
    const d = nowIst.getUTCDate();
    const opensUtc  = Date.UTC(y, mo, d, oh, om) - IST_OFFSET_MS;
    const closesUtc = Date.UTC(y, mo, d, ch, cm) - IST_OFFSET_MS;
    const crossesMidnight = (ch * 60 + cm) <= (oh * 60 + om);
    let opensMs:  number;
    let closesMs: number;
    if (!crossesMidnight) {
      opensMs  = opensUtc;
      closesMs = closesUtc;
    } else {
      const nowMinsIst = nowIst.getUTCHours() * 60 + nowIst.getUTCMinutes();
      const closeMins  = ch * 60 + cm;
      if (nowMinsIst < closeMins) {
        opensMs  = opensUtc  - 24 * 60 * 60 * 1000;
        closesMs = closesUtc;
      } else {
        opensMs  = opensUtc;
        closesMs = closesUtc + 24 * 60 * 60 * 1000;
      }
    }
    if (nowMs < opensMs) {
      return NextResponse.json(
        err(`Shop opens at ${opening} — check-in not allowed yet`, "OUTSIDE_HOURS"),
        { status: 409 }
      );
    }
    if (nowMs >= closesMs) {
      return NextResponse.json(
        err("Shop has closed for the day — check-in not allowed", "OUTSIDE_HOURS"),
        { status: 409 }
      );
    }
  }

  const tableId        = (orderItem as { table_id?: string } | null)?.table_id;
  const now            = new Date();
  const scheduledStart = new Date(booking.scheduled_start);
  const scheduledEnd   = new Date(booking.scheduled_end);
  const bookedMs       = scheduledEnd.getTime() - scheduledStart.getTime();

  const maxEarlyCheckinMs = 45 * 60 * 1000;
  if (scheduledStart.getTime() - now.getTime() > maxEarlyCheckinMs) {
    return NextResponse.json(
      err("Check-in is only allowed up to 45 minutes before the scheduled start time. Reschedule if they want to play now.", "TOO_EARLY"),
      { status: 400 }
    );
  }

  let actualStart: Date;
  let expectedEnd: Date;

  if (now.getTime() < scheduledStart.getTime()) {
    // EARLY arrival — shift the slot, but only if the table is free right now.
    // Any other running order_item on this table means the table is occupied.
    if (tableId) {
      const { data: busyItems } = await admin
        .from("order_items")
        .select("id")
        .eq("table_id", tableId)
        .eq("status", "running")
        .eq("is_deleted", false)
        .neq("id", booking.order_item_id);
      if (busyItems && busyItems.length > 0) {
        return NextResponse.json(
          err("Table is currently in use — early check-in not available", "TABLE_BUSY"),
          { status: 409 }
        );
      }
    }
    actualStart = now;
    expectedEnd = new Date(now.getTime() + bookedMs); // shift end so duration stays the same
  } else if (now.getTime() <= scheduledEnd.getTime()) {
    // ON-TIME or LATE arrival — anchor to scheduled times.
    // Late customers play less but are billed for the full booked slot
    // (the booking engine derives the bill from expected_end - actual_start).
    actualStart = scheduledStart;
    expectedEnd = scheduledEnd;
  } else {
    // Past scheduled_end — booking has expired, staff should mark no-show
    return NextResponse.json(
      err("Booking has expired — mark as no-show instead", "BOOKING_EXPIRED"),
      { status: 410 }
    );
  }

  await Promise.all([
    admin.from("bookings").update({ status: "checked_in" }).eq("id", bookingId),
    admin.from("order_items").update({
      status:       "running",
      actual_start: actualStart.toISOString(),
      expected_end: expectedEnd.toISOString(),
    }).eq("id", booking.order_item_id),
    admin.from("orders").update({ status: "open" }).eq("id", booking.order_id),
  ]);

  return NextResponse.json(ok({ order_id: booking.order_id }));
}
