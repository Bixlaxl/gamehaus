import type { POSOrder } from "@/store/pos";

export interface GroupedPOSOrder extends POSOrder {
  orderIds: string[];
  points_redeemed_online: number;
}

export function cleanPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "").slice(-10);
}

export function isGenericName(name: string | null | undefined): boolean {
  if (!name) return true;
  const clean = name.trim().toLowerCase();
  return (
    clean === "" ||
    clean === "walk-in" ||
    clean === "walkin" ||
    clean === "customer" ||
    clean === "guest" ||
    clean === "anonymous"
  );
}

export function groupOrders(orders: POSOrder[]): GroupedPOSOrder[] {
  const groups: Map<string, POSOrder[]> = new Map();
  const ungrouped: POSOrder[] = [];

  for (const order of orders) {
    const phone = cleanPhone(order.customer_phone);
    const name = order.customer_name?.trim();

    if (phone && phone.length === 10) {
      // Group by phone number
      const key = `phone_${phone}`;
      const existing = groups.get(key) || [];
      existing.push(order);
      groups.set(key, existing);
    } else if (name && !isGenericName(name)) {
      // Group by customer name if no phone is present
      const key = `name_${name.toLowerCase()}`;
      const existing = groups.get(key) || [];
      existing.push(order);
      groups.set(key, existing);
    } else {
      // Generic walk-in orders stay separate
      ungrouped.push(order);
    }
  }

  const result: GroupedPOSOrder[] = [];

  // Merge grouped orders
  for (const [_, groupList] of groups.entries()) {
    if (groupList.length === 0) continue;

    // Sort by created_at ascending so the oldest order is primary
    groupList.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const primary = groupList[0];
    const orderIds = groupList.map((o) => o.id);

    // Aggregate lists
    const combinedItems = groupList.flatMap((o) => o.items ?? []);
    const combinedExtras = groupList.flatMap((o) => o.extras ?? []);

    // Sum totals
    let totalSubtotal = 0;
    let totalDiscount = 0;
    let totalPublicDiscount = 0;
    let totalTotalAmount = 0;
    let totalAdvancePaid = 0;
    let totalPointsRedeemed = 0;
    let totalPointsRedeemedOnline = 0;

    for (const o of groupList) {
      totalSubtotal += Number(o.subtotal) || 0;
      totalDiscount += Number(o.discount_amount) || 0;
      const pubDisc = Number((o as any).public_discount_amount);
      const discAmt = Number(o.discount_amount);
      const effectivePub = (!isNaN(pubDisc) && pubDisc > 0) ? pubDisc : (!isNaN(discAmt) && discAmt > 0 ? discAmt : 0);
      totalPublicDiscount += effectivePub;
      totalTotalAmount += Number(o.total_amount) || 0;
      totalAdvancePaid += Number(o.advance_paid) || 0;
      totalPointsRedeemed += Number(o.points_redeemed) || 0;
      totalPointsRedeemedOnline += Number((o as any).points_redeemed_online) || 0;
    }

    result.push({
      ...primary,
      orderIds,
      items: combinedItems,
      extras: combinedExtras,
      subtotal: totalSubtotal,
      discount_amount: totalDiscount,
      public_discount_amount: totalPublicDiscount,
      total_amount: totalTotalAmount,
      advance_paid: totalAdvancePaid,
      points_redeemed: totalPointsRedeemed,
      points_redeemed_online: totalPointsRedeemedOnline,
    } as GroupedPOSOrder);
  }

  // Add ungrouped orders as single-order groups
  for (const order of ungrouped) {
    result.push({
      ...order,
      orderIds: [order.id],
      points_redeemed_online: Number((order as any).points_redeemed_online) || 0,
    });
  }

  return result;
}
