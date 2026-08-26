import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";
import { sendWhatsAppCancellation } from "@/lib/whatsapp";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Staff-side booking cancellation.
 * Allows staff to cancel manual (or online) bookings at their location.
 * Frees up table slots immediately and optionally sends WhatsApp cancellation notification.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { data: viewer } = await supabase
    .from("users")
    .select("id, role, location_id")
    .eq("id", session.user.id)
    .single();

  if (!viewer || (viewer.role !== "owner" && viewer.role !== "staff")) {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  const bookingId = params.id;
  if (!bookingId) {
    return NextResponse.json(err("Booking ID required", "VALIDATION_ERROR"), { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const body = await request.json().catch(() => ({}));
    const sendWhatsApp = body.send_whatsapp !== false;
    const reason = body.reason || "Staff cancelled booking";

    // 1. Fetch booking with order and table details
    const { data: booking, error: bookingErr } = await admin
      .from("bookings")
      .select(`
        id,
        status,
        order_id,
        order_item_id,
        scheduled_start,
        scheduled_end,
        order:orders(
          id,
          status,
          type,
          customer_name,
          customer_phone,
          location_id,
          advance_paid,
          points_redeemed,
          points_redeemed_online
        ),
        order_item:order_items(
          id,
          status,
          table_id,
          table:tables(id, name, location_id)
        )
      `)
      .eq("id", bookingId)
      .single();

    if (bookingErr || !booking) {
      return NextResponse.json(err("Booking not found", "NOT_FOUND"), { status: 404 });
    }

    const order = booking.order as any;
    const orderItem = booking.order_item as any;
    const locationId = order?.location_id || orderItem?.table?.location_id;

    // Staff can only cancel bookings at their own location
    if (viewer.role === "staff" && viewer.location_id && locationId && viewer.location_id !== locationId) {
      return NextResponse.json(err("This booking belongs to a different location", "FORBIDDEN"), { status: 403 });
    }

    if (booking.status === "cancelled") {
      return NextResponse.json(err("Booking is already cancelled", "ALREADY_CANCELLED"), { status: 400 });
    }

    // 2. Mark booking and order_items as cancelled
    await admin.from("bookings").update({ status: "cancelled" }).eq("id", bookingId);

    if (booking.order_item_id) {
      await admin.from("order_items").update({ status: "cancelled" }).eq("id", booking.order_item_id);
    }

    // If order has no other active items/bookings, mark order cancelled as well
    if (booking.order_id) {
      await admin.from("orders").update({ status: "cancelled" }).eq("id", booking.order_id);

      // Restore loyalty points ONLY if they were actually deducted
      if (order?.customer_phone) {
        const actuallyDeducted = Number(order.points_redeemed_online || 0);
        if (actuallyDeducted > 0) {
          const { data: profile } = await admin
            .from("customer_profiles")
            .select("points_balance")
            .eq("phone", order.customer_phone)
            .single();

          if (profile) {
            await admin
              .from("customer_profiles")
              .update({ points_balance: (profile.points_balance || 0) + actuallyDeducted })
              .eq("phone", order.customer_phone);
          }
        }
      }
    }

    // 3. Trigger WhatsApp notification if requested
    if (sendWhatsApp && order?.customer_phone && booking.order_id) {
      sendWhatsAppCancellation(booking.order_id, 0, 0).catch((e) => {
        console.error("[WhatsApp] Failed to send staff cancellation notice:", e);
      });
    }

    return NextResponse.json(ok({
      success: true,
      booking_id: bookingId,
      order_id: booking.order_id,
      reason,
    }));
  } catch (error: any) {
    console.error("[Staff Booking Cancel] Error:", error);
    return NextResponse.json(err(error.message || "Failed to cancel booking", "SERVER_ERROR"), { status: 500 });
  }
}
