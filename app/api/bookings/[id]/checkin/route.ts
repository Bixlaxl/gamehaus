import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/validators/schemas";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bookingId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();

  if (bookingError || !booking) {
    return NextResponse.json(err("Booking not found", "NOT_FOUND"), { status: 404 });
  }

  if (booking.status !== "confirmed") {
    return NextResponse.json(err("Booking is not in confirmed state", "INVALID_STATE"), { status: 400 });
  }

  // Update booking status
  await supabase
    .from("bookings")
    .update({ status: "checked_in" })
    .eq("id", bookingId);

  // Start the session (set order_item to running)
  const now = new Date().toISOString();
  await supabase
    .from("order_items")
    .update({
      status: "running",
      actual_start: now,
      expected_end: booking.scheduled_end,
    })
    .eq("id", booking.order_item_id);

  return NextResponse.json(ok({ order_id: booking.order_id }));
}
