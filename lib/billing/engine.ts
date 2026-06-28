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
  advancePaid: number;
  totalDue: number;
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
 * @param fixedDiscountAmount  Existing discount amount saved on order
 */
export function calculateBill(
  items: OrderItem[],
  extras: OrderExtra[],
  now: Date,
  coupon: Coupon | null = null,
  advancePaid: number = 0,
  fixedDiscountAmount: number = 0
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

  let discountAmount = fixedDiscountAmount || 0;
  if (coupon) {
    if (coupon.discount_type === "percent") {
      discountAmount = Math.round((scheduledSubtotal * coupon.discount_value) / 100 * 100) / 100;
    } else {
      discountAmount = coupon.discount_value;
    }
  }
  discountAmount = Math.min(discountAmount, scheduledSubtotal);

  // Advance deducted from scheduled session cost after discount (fixed, known at booking time).
  // Overtime accrues on top of that — not absorbed by advance or discount.
  const overtimeTotal = Math.max(0, sessionTotal - scheduledSubtotal);
  const scheduledSessionNet = Math.max(0, scheduledSubtotal - discountAmount);
  const netSessionDue = advancePaid > 0
    ? Math.max(0, scheduledSessionNet - advancePaid) + overtimeTotal
    : Math.max(0, sessionTotal - discountAmount);

  const totalDue = Math.max(0, netSessionDue + extraTotal);

  return {
    tableLines,
    extraLines,
    subtotal,
    scheduledSubtotal,
    discountAmount: Math.round(discountAmount * 100) / 100,
    advancePaid,
    totalDue: Math.round(totalDue * 100) / 100,
  };
}
