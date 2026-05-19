import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bookingId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const admin = createAdminClient();

  const { data: booking, error: bookingError } = await admin
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

  // Update booking status and start the session in parallel.
  // Session anchored to booked slot so customer is billed for full reserved slot.
  await Promise.all([
    admin.from("bookings").update({ status: "checked_in" }).eq("id", bookingId),
    admin.from("order_items").update({
      status:       "running",
      actual_start: booking.scheduled_start,
      expected_end: booking.scheduled_end,
    }).eq("id", booking.order_item_id),
  ]);

  return NextResponse.json(ok({ order_id: booking.order_id }));
}
