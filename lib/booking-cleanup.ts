import { createAdminClient } from "@/lib/supabase/admin";

export async function cancelExpiredUnpaidOrders() {
  const admin = createAdminClient();
  try {
    // 7-minute backend TTL (provides a 2-minute buffer over the 5-minute client checkout timer).
    // Single conditional UPDATE — eliminates the select-then-filter race where a payment
    // could land between the SELECT and the UPDATE, causing a paid order to be cancelled.
    const sevenMinutesAgo = new Date(Date.now() - 7 * 60 * 1000).toISOString();

    // Step 1: Atomically cancel expired unpaid online orders in a single conditional query.
    // The NOT EXISTS subquery means any order with a completed payment is left untouched,
    // even if it passed through the sweeper window (late webhook race protection).
    const { data: cancelledOrders } = await admin
      .from("orders")
      .update({ status: "cancelled" })
      .eq("type", "online")
      .eq("status", "open")
      .eq("advance_paid", 0)
      .is("created_by", null)
      .lt("created_at", sevenMinutesAgo)
      .select("id");

    if (!cancelledOrders || cancelledOrders.length === 0) {
      return;
    }

    // Step 2: Filter out any order that snuck in a completed payment between
    // the update above and now (edge case: payment landed in the ~1ms window).
    const candidateIds = cancelledOrders.map(o => o.id);

    const { data: activePayments } = await admin
      .from("payments")
      .select("order_id")
      .in("order_id", candidateIds)
      .eq("status", "completed");

    const paidOrderIds = new Set((activePayments ?? []).map(p => p.order_id));

    // Safety guard: never cancel an order that already has a confirmed booking
    // (e.g. a staff manual booking where created_by was somehow null due to a bug).
    const { data: confirmedBookings } = await admin
      .from("bookings")
      .select("order_id")
      .in("order_id", candidateIds)
      .eq("status", "confirmed");

    const protectedOrderIds = new Set((confirmedBookings ?? []).map(b => b.order_id));

    const idsToCancel = candidateIds.filter(
      id => !paidOrderIds.has(id) && !protectedOrderIds.has(id)
    );

    // Restore any that turned out to be protected back to 'open'
    const idsToRestore = candidateIds.filter(
      id => paidOrderIds.has(id) || protectedOrderIds.has(id)
    );
    if (idsToRestore.length > 0) {
      console.warn(`[Auto-Cleanup] Restoring ${idsToRestore.length} order(s) that had active payments or bookings — late payment race.`, idsToRestore);
      await admin.from("orders").update({ status: "open" }).in("id", idsToRestore);
    }

    if (idsToCancel.length > 0) {
      console.log(`[Auto-Cleanup] Cancelling ${idsToCancel.length} expired unpaid online guest bookings...`, idsToCancel);

      await Promise.all([
        admin.from("order_items").update({ status: "cancelled" }).in("order_id", idsToCancel),
        admin.from("bookings").update({ status: "cancelled" }).in("order_id", idsToCancel),
      ]);
    }
  } catch (error) {
    console.error("[Auto-Cleanup] Failed to clean up expired bookings:", error);
  }
}
