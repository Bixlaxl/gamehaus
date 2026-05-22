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

  // Fetch booking with the order_item so we know table_id (for the early-arrival conflict check)
  const { data: booking, error: bookingError } = await admin
    .from("bookings")
    .select("*, order_item:order_items(table_id)")
    .eq("id", bookingId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json(err("Booking not found", "NOT_FOUND"), { status: 404 });
  }

  if (booking.status !== "confirmed") {
    return NextResponse.json(err("Booking is not in confirmed state", "INVALID_STATE"), { status: 400 });
  }

  const tableId        = (booking.order_item as { table_id: string } | null)?.table_id;
  const now            = new Date();
  const scheduledStart = new Date(booking.scheduled_start);
  const scheduledEnd   = new Date(booking.scheduled_end);
  const bookedMs       = scheduledEnd.getTime() - scheduledStart.getTime();

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
  ]);

  return NextResponse.json(ok({ order_id: booking.order_id }));
}
