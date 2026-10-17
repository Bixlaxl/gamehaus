import { createAdminClient } from "@/lib/supabase/admin";

export async function cancelExpiredUnpaidOrders() {
  const admin = createAdminClient();
  try {
    // 7-minute backend TTL (provides a 2-minute buffer over the 5-minute client checkout timer)
    const sevenMinutesAgo = new Date(Date.now() - 7 * 60 * 1000).toISOString();
    
    // Find open, unpaid online orders created more than 7 minutes ago by guests (created_by is null)
    const { data: expiredOrders } = await admin
      .from("orders")
      .select("id")
      .eq("type", "online")
      .eq("status", "open")
      .eq("advance_paid", 0)
      .is("created_by", null)
      .lt("created_at", sevenMinutesAgo);

    if (expiredOrders && expiredOrders.length > 0) {
      const candidateIds = expiredOrders.map(o => o.id);

      // Verify none of these candidate orders have a completed payment
      const { data: activePayments } = await admin
        .from("payments")
        .select("order_id")
        .in("order_id", candidateIds)
        .eq("status", "completed");

      const paidOrderIds = new Set((activePayments ?? []).map(p => p.order_id));

      // Safety guard: never auto-cancel an order that has a confirmed booking.
      // Manual staff bookings (created via /api/pos/manual-booking) always write a
      // confirmed booking row immediately on creation. Abandoned guest checkouts never
      // reach confirmed status — they stay pending until payment is received.
      // This makes it structurally impossible for this cleanup to touch a manual
      // booking, even if the created_by / advance_paid filters ever have edge cases
      // (e.g. a stale session causing created_by to be written as null).
      const { data: confirmedBookings } = await admin
        .from("bookings")
        .select("order_id")
        .in("order_id", candidateIds)
        .eq("status", "confirmed");

      const protectedOrderIds = new Set((confirmedBookings ?? []).map(b => b.order_id));

      const idsToCancel = candidateIds.filter(
        id => !paidOrderIds.has(id) && !protectedOrderIds.has(id)
      );

      if (idsToCancel.length > 0) {
        console.log(`[Auto-Cleanup] Cancelling ${idsToCancel.length} expired unpaid online guest bookings...`, idsToCancel);
        
        await Promise.all([
          admin.from("orders").update({ status: "cancelled" }).in("id", idsToCancel),
          admin.from("order_items").update({ status: "cancelled" }).in("order_id", idsToCancel),
          admin.from("bookings").update({ status: "cancelled" }).in("order_id", idsToCancel)
        ]);
      }
    }
  } catch (err) {
    console.error("[Auto-Cleanup] Failed to clean up expired bookings:", err);
  }
}
