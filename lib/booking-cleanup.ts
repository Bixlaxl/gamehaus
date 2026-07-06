import { createAdminClient } from "@/lib/supabase/admin";

export async function cancelExpiredUnpaidOrders() {
  const admin = createAdminClient();
  try {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    
    // Find open, unpaid online orders created more than 2 minutes ago by guests (created_by is null)
    const { data: expiredOrders } = await admin
      .from("orders")
      .select("id")
      .eq("type", "online")
      .eq("status", "open")
      .eq("advance_paid", 0)
      .is("created_by", null)
      .lt("created_at", twoMinutesAgo);

    if (expiredOrders && expiredOrders.length > 0) {
      const ids = expiredOrders.map(o => o.id);
      console.log(`[Auto-Cleanup] Cancelling ${ids.length} expired unpaid online bookings...`, ids);
      
      await Promise.all([
        admin.from("orders").update({ status: "cancelled" }).in("id", ids),
        admin.from("order_items").update({ status: "cancelled" }).in("order_id", ids),
        admin.from("bookings").update({ status: "cancelled" }).in("order_id", ids)
      ]);
    }
  } catch (err) {
    console.error("[Auto-Cleanup] Failed to clean up expired bookings:", err);
  }
}
