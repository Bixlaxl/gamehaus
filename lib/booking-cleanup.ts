import { createAdminClient } from "@/lib/supabase/admin";

export async function cancelExpiredUnpaidOrders() {
  const admin = createAdminClient();
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    // Find open, unpaid online orders created more than 5 minutes ago by guests (created_by is null)
    const { data: expiredOrders } = await admin
      .from("orders")
      .select("id")
      .eq("type", "online")
      .eq("status", "open")
      .eq("advance_paid", 0)
      .is("created_by", null)
      .lt("created_at", fiveMinutesAgo);

    if (expiredOrders && expiredOrders.length > 0) {
      const candidateIds = expiredOrders.map(o => o.id);

      // Verify none of these candidate orders have a completed payment
      const { data: activePayments } = await admin
        .from("payments")
        .select("order_id")
        .in("order_id", candidateIds)
        .eq("status", "completed");

      const paidOrderIds = new Set((activePayments ?? []).map(p => p.order_id));
      const idsToCancel = candidateIds.filter(id => !paidOrderIds.has(id));

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
