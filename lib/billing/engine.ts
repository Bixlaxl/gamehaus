import type { OrderItem, OrderExtra, Coupon } from "@/lib/supabase/types";

// Legacy grace constant — only referenced by the secondary OrderPanel
// (the primary ContextPanel uses signed-countdown overtime display now).
// Kept for back-compat; safe to remove if OrderPanel is ever consolidated.
export const GRACE_MINS = 5;

export interface BillingLineItem {
  id: string;
  label: string;
  durationMins: number;
  scheduledMins: number;
  overtimeMins: number;   // raw OT elapsed (for display)
  billedOTMins: number;   // OT minutes actually charged (0 in grace, block-rounded after)
  ratePerHour: number;
  amount: number;
  scheduledAmount: number;
  overtimeAmount: number;
}

export interface ExtraLineItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  amount: number;
}

export interface BillResult {
  tableLines: BillingLineItem[];
  extraLines: ExtraLineItem[];
  subtotal: number;
  scheduledSubtotal: number;
  discountAmount: number;
  memberDiscountAmount: number;
  freeHoursDiscountAmount: number;
  advancePaid: number;
  totalDue: number;
}

/**
 * Compute total free hours discount amount for a list of active order items.
 */
export function computeFreeHoursDiscount(
  items: OrderItem[],
  allMemberships: any[],
  now: Date,
  tablesRef: any[] = []
): number {
  if (!allMemberships || allMemberships.length === 0) return 0;
  let totalFreeHoursDiscount = 0;
  const ledgerUpdates = new Map<string, Record<string, number>>();

  for (const m of allMemberships) {
    const planObj = m.plan ? (Array.isArray(m.plan) ? m.plan[0] : m.plan) : null;
    const planFreeHrs = Number(planObj?.free_hrs || 0);
    const ledger: Record<string, number> = { ...(m.free_hours_ledger || {}) };
    if (planFreeHrs > 0 && Object.keys(ledger).length === 0) {
      ["snooker", "pool", "ps5", "foosball", "simulator", "standard"].forEach((t) => {
        ledger[t] = planFreeHrs;
      });
    }
    ledgerUpdates.set(m.id, ledger);
  }

  for (const item of items) {
    if (item.status === "cancelled" || item.is_deleted) continue;
    const tableId = item.table_id;
    const storeTable = tablesRef.find((t: any) => t.id === tableId);
    const tableMeta = (item as any).table as { id?: string; type?: string; name?: string } | null;
    const tableType = tableMeta?.type || storeTable?.type || "";

    const itemMembershipId = (item as any).membership_id;
    const isBound = (m: any) => !m.bound_table_ids || m.bound_table_ids.length === 0 || m.bound_table_ids.includes(tableId ?? "");
    let coveringMembership = itemMembershipId
      ? allMemberships.find(m => m.id === itemMembershipId && isBound(m))
      : allMemberships.find(m => isBound(m));

    if (!coveringMembership) continue;

    const ledger = ledgerUpdates.get(coveringMembership.id);
    if (!ledger) continue;
    const remainingFreeHrs = Number(ledger[tableType]) || 0;
    if (remainingFreeHrs <= 0) continue;

    let start: Date;
    let end: Date;
    if (item.actual_start) {
      start = new Date(item.actual_start);
      end = item.expected_end
        ? new Date(item.expected_end)
        : item.actual_end
        ? new Date(item.actual_end)
        : now;
    } else if (item.scheduled_start && item.scheduled_end) {
      start = new Date(item.scheduled_start);
      end = new Date(item.scheduled_end);
    } else {
      continue;
    }

    const durationHrs = (end.getTime() - start.getTime()) / (3600 * 1000);
    const maxRedeem = Math.min(durationHrs, remainingFreeHrs);
    const freeHoursDiscount = maxRedeem * (item.rate_per_hour || 0);
    totalFreeHoursDiscount += freeHoursDiscount;
    ledger[tableType] = Math.max(0, Math.round((remainingFreeHrs - maxRedeem) * 100) / 100);
  }

  return totalFreeHoursDiscount;
}

/**
 * Calculate the bill for an order.
 * Pure function — no side effects, no async.
 * Called every second on POS for live preview, and once at finalize.
 *
 * @param items     Active order_items (not cancelled, not is_deleted)
 * @param extras    Active order_extras (not is_deleted)
 * @param now       Current time — pass new Date() for live, actual_end for final
 * @param coupon    Optional coupon (only for full-prepay online orders)
 * @param advancePaid  Amount paid online at booking time
 * @param fixedDiscountAmount  Existing public discount amount saved on order
 * @param memberDiscountPct    Member discount percentage (applies to session, overtime & extras)
 * @param freeHoursDiscountAmount  Free hours discount amount
 */
export function calculateBill(
  items: OrderItem[],
  extras: OrderExtra[],
  now: Date,
  coupon: Coupon | null = null,
  advancePaid: number = 0,
  fixedDiscountAmount: number = 0,
  memberDiscountPct: number = 0,
  freeHoursDiscountAmount: number = 0
): BillResult {
  const tableLines: BillingLineItem[] = [];

  for (const item of items) {
    if (item.status === "cancelled" || item.is_deleted) continue;
    let start: Date;
    let billingEnd: Date;
    if (item.actual_start) {
      start = new Date(item.actual_start);
      billingEnd = item.expected_end
        ? new Date(item.expected_end)
        : item.actual_end
        ? new Date(item.actual_end)
        : now;
    } else if (item.scheduled_start && item.scheduled_end) {
      start = new Date(item.scheduled_start);
      billingEnd = new Date(item.scheduled_end);
    } else if (item.scheduled_duration_mins && item.scheduled_duration_mins > 0) {
      start = now;
      billingEnd = new Date(now.getTime() + item.scheduled_duration_mins * 60000);
    } else {
      continue;
    }


    const scheduledMins   = Math.ceil((billingEnd.getTime() - start.getTime()) / 60000);
    const scheduledAmount = Math.round((scheduledMins / 60) * item.rate_per_hour * 100) / 100;

    tableLines.push({
      id:             item.id,
      label:          "Table session",
      durationMins:   scheduledMins,
      scheduledMins,
      overtimeMins:   0,
      billedOTMins:   0,
      ratePerHour:    item.rate_per_hour,
      amount:         scheduledAmount,
      scheduledAmount,
      overtimeAmount: 0,
    });
  }

  const groupedExtras = new Map<string, ExtraLineItem>();
  for (const e of extras) {
    if (e.is_deleted) continue;
    const key = `${e.name}_${e.price}`;
    const existing = groupedExtras.get(key);
    if (existing) {
      existing.quantity += e.quantity;
      existing.amount = Math.round(existing.price * existing.quantity * 100) / 100;
    } else {
      groupedExtras.set(key, {
        id: e.id,
        name: e.name,
        price: e.price,
        quantity: e.quantity,
        amount: Math.round(e.price * e.quantity * 100) / 100,
      });
    }
  }
  const extraLines = Array.from(groupedExtras.values());

  const sessionTotal = Math.round(tableLines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
  const extraTotal   = Math.round(extraLines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
  const subtotal     = Math.round((sessionTotal + extraTotal) * 100) / 100;

  const scheduledSubtotal = Math.round(
    tableLines.reduce((sum, l) => sum + l.scheduledAmount, 0) * 100
  ) / 100;

  let publicDiscount = fixedDiscountAmount || 0;
  if (!fixedDiscountAmount && coupon) {
    if (coupon.discount_type === "percent") {
      publicDiscount = Math.round((scheduledSubtotal * coupon.discount_value) / 100 * 100) / 100;
    } else {
      publicDiscount = coupon.discount_value;
    }
  }
  const maxPublicDiscount = Math.max(0, scheduledSubtotal - freeHoursDiscountAmount);
  publicDiscount = Math.min(publicDiscount, maxPublicDiscount);

  const overtimeTotal = Math.max(0, sessionTotal - scheduledSubtotal);
  const remainingScheduledAfterPublic = Math.max(0, scheduledSubtotal - publicDiscount);
  const remainingScheduledAfterFree = Math.max(0, remainingScheduledAfterPublic - freeHoursDiscountAmount);

  // Member discount applies to session (scheduled + overtime) AND extra items
  const sessionNetBase = remainingScheduledAfterFree + overtimeTotal;
  const sessionMemberDiscount = memberDiscountPct > 0
    ? Math.round(sessionNetBase * (memberDiscountPct / 100) * 100) / 100
    : 0;
  const tableNet = Math.max(0, sessionNetBase - sessionMemberDiscount);

  const extraMemberDiscount = memberDiscountPct > 0
    ? Math.round(extraTotal * (memberDiscountPct / 100) * 100) / 100
    : 0;
  const extraNet = Math.max(0, extraTotal - extraMemberDiscount);

  const memberDiscountAmount = sessionMemberDiscount + extraMemberDiscount;

  // Online advance paid (advancePaid) covers table session charges.
  // Excess online table advance does not swallow beverage/extra sales.
  const tableDue = advancePaid > 0
    ? Math.max(0, tableNet - advancePaid)
    : tableNet;

  const totalDue = tableDue + extraNet;

  return {
    tableLines,
    extraLines,
    subtotal,
    scheduledSubtotal,
    discountAmount: Math.round(publicDiscount * 100) / 100,
    memberDiscountAmount,
    freeHoursDiscountAmount,
    advancePaid,
    totalDue: Math.round(totalDue * 100) / 100,
  };
}

/**
 * Helper to recompute and update orders table totals (subtotal, discount_amount, total_amount, amount_due) in Supabase.
 * Call this whenever order items or extras are added, modified, or deleted.
 */
export async function syncOrderTotals(admin: any, orderId: string): Promise<void> {
  const [{ data: orderRow }, { data: allItems }, { data: allExtras }] = await Promise.all([
    admin.from("orders").select("*, coupon:coupons(*)").eq("id", orderId).maybeSingle(),
    admin.from("order_items").select("*, table:tables(*)").eq("order_id", orderId).eq("is_deleted", false),
    admin.from("order_extras").select("*").eq("order_id", orderId).eq("is_deleted", false),
  ]);

  if (!orderRow) return;

  const activeItems = (allItems ?? []).filter((i: any) => i.status !== "cancelled");
  const activeExtras = (allExtras ?? []).filter((e: any) => !e.name.startsWith("[PENDING]"));
  const pubDisc = (() => {
    const pub = Number((orderRow as any).public_discount_amount);
    if (!isNaN(pub) && pub > 0) return pub;
    const disc = Number(orderRow.discount_amount);
    if (!isNaN(disc) && disc > 0) return disc;
    return 0;
  })();

  const freshBill = calculateBill(
    activeItems as any,
    activeExtras as any,
    new Date(),
    orderRow.coupon as any,
    orderRow.advance_paid ?? 0,
    pubDisc
  );

  const totalDisc = freshBill.discountAmount + freshBill.memberDiscountAmount;
  await admin
    .from("orders")
    .update({
      subtotal: freshBill.subtotal,
      discount_amount: totalDisc,
      total_amount: Math.max(0, Math.round((freshBill.subtotal - totalDisc) * 100) / 100),
      amount_due: freshBill.totalDue,
    })
    .eq("id", orderId);
}
