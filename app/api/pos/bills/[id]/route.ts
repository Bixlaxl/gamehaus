import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";
import { getAppSettings } from "@/lib/settings";

export const runtime = "edge";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const admin = createAdminClient();

  // 1. Fetch order details to know customer phone, total amount, and extras for stock revert
  const [
    { data: order, error: orderError },
    { data: extras }
  ] = await Promise.all([
    admin.from("orders").select("*").eq("id", orderId).single(),
    admin.from("order_extras").select("*").eq("order_id", orderId)
  ]);

  if (orderError || !order) {
    return NextResponse.json(err("Order not found", "NOT_FOUND"), { status: 404 });
  }

  // 2. Revert inventory stock for any items in this bill
  for (const extra of extras ?? []) {
    if (!extra.inventory_item_id || extra.is_deleted) continue;
    const { data: inv } = await admin
      .from("inventory_items")
      .select("stock_count")
      .eq("id", extra.inventory_item_id)
      .maybeSingle();
    if (inv && inv.stock_count !== null) {
      const newStock = inv.stock_count + extra.quantity;
      await admin
        .from("inventory_items")
        .update({ stock_count: newStock })
        .eq("id", extra.inventory_item_id);
    }
  }

  // 3. Revert customer profile stats (spent, visits, points balance)
  if (order.customer_phone) {
    const settings = await getAppSettings(admin);
    const earnRate = settings.loyalty.earn_rupees_per_point;
    
    const { data: profile } = await admin
      .from("customer_profiles")
      .select("visit_count, total_spent, points_balance")
      .eq("phone", order.customer_phone)
      .maybeSingle();

    if (profile) {
      // Calculate points earned from this order total and points redeemed
      const totalAmt = order.total_amount || 0;
      const pointsEarned = Math.floor(totalAmt / earnRate);
      const pointsRedeemed = order.points_redeemed || 0;
      
      const newVisitCount = Math.max(0, profile.visit_count - 1);
      const newTotalSpent = Math.max(0, Math.round((profile.total_spent - totalAmt) * 100) / 100);
      const newPointsBalance = Math.max(0, profile.points_balance - pointsEarned + pointsRedeemed);

      await admin
        .from("customer_profiles")
        .update({
          visit_count: newVisitCount,
          total_spent: newTotalSpent,
          points_balance: newPointsBalance
        })
        .eq("phone", order.customer_phone);
    }
  }

  // 4. Delete payments first (respect foreign keys)
  await admin.from("payments").delete().eq("order_id", orderId);
  // Delete bookings
  await admin.from("bookings").delete().eq("order_id", orderId);
  // Delete order items
  await admin.from("order_items").delete().eq("order_id", orderId);
  // Delete order extras
  await admin.from("order_extras").delete().eq("order_id", orderId);
  // Delete parent order
  const { error: deleteOrderError } = await admin.from("orders").delete().eq("id", orderId);

  if (deleteOrderError) {
    return NextResponse.json(err("Failed to delete order: " + deleteOrderError.message, "DB_ERROR"), { status: 500 });
  }

  return NextResponse.json(ok({ success: true }));
}
