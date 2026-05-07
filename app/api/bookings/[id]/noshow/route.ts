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
    return NextResponse.json(err("Booking is not confirmed", "INVALID_STATE"), { status: 400 });
  }

  // Enforce: can only mark no-show AFTER held_until
  const heldUntil = new Date(booking.held_until);
  if (new Date() < heldUntil) {
    return NextResponse.json(
      err(
        `Cannot mark no-show before held_until (${heldUntil.toLocaleTimeString()})`,
        "TOO_EARLY"
      ),
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  await supabase
    .from("bookings")
    .update({
      status: "no_show",
      no_show_marked_by: user.id,
      no_show_marked_at: now,
    })
    .eq("id", bookingId);

  // Cancel the order item to release the slot
  await supabase
    .from("order_items")
    .update({ status: "cancelled" })
    .eq("id", booking.order_item_id);

  return NextResponse.json(ok({ released: true }));
}
