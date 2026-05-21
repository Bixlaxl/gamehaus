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
  const user = session.user;

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
    return NextResponse.json(err("Booking is not confirmed", "INVALID_STATE"), { status: 400 });
  }

  const now = new Date().toISOString();

  // Mark booking no-show + cancel order item + fetch order — all independent
  const [, , { data: order }] = await Promise.all([
    admin.from("bookings").update({
      status:            "no_show",
      no_show_marked_by: user.id,
      no_show_marked_at: now,
    }).eq("id", bookingId),
    admin.from("order_items").update({ status: "cancelled" }).eq("id", booking.order_item_id),
    admin.from("orders").select("*").eq("id", booking.order_id).single(),
  ]);

  if (order && order.status === "open") {
    const advancePaid = order.advance_paid ?? 0;

    await admin
      .from("orders")
      .update({
        status:          "finalized",
        subtotal:        advancePaid,
        discount_amount: 0,
        total_amount:    advancePaid,
        amount_due:      0,
        finalized_at:    now,
      })
      .eq("id", order.id);
  }

  return NextResponse.json(ok({ released: true }));
}
