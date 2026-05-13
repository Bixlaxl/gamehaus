import type { OrderItem, OrderExtra, Coupon } from "@/lib/supabase/types";

// OT grace + block constants — used by billing engine and POS UI
export const GRACE_MINS    = 5;
export const OT_BLOCK_MINS = 15;

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
 */
export function calculateBill(
  items: OrderItem[],
  extras: OrderExtra[],
  now: Date,
  coupon: Coupon | null = null,
  advancePaid: number = 0
): BillResult {
  const tableLines: BillingLineItem[] = [];

  for (const item of items) {
    if (item.status === "cancelled" || item.is_deleted) continue;
    if (!item.actual_start) continue; // not started yet — 0 charge

    const start = new Date(item.actual_start);
    let end: Date;

    if (item.actual_end) {
      end = new Date(item.actual_end);
    } else if (item.status === "running") {
      end = now;
    } else {
      continue; // scheduled but not started, or finished without actual_end (shouldn't happen)
    }

    const diffMs = end.getTime() - start.getTime();
    const durationMins = Math.ceil(diffMs / 60000);

    let scheduledMins = durationMins;
    let overtimeMins  = 0;
    let billedOTMins  = 0;

    if (item.expected_end) {
      const expectedEnd = new Date(item.expected_end);
      const scheduledMs = Math.max(0, expectedEnd.getTime() - start.getTime());
      scheduledMins     = Math.min(durationMins, Math.ceil(scheduledMs / 60000));
      overtimeMins      = Math.max(0, durationMins - scheduledMins);

      // Grace window is free; after that charge in 15-min blocks
      billedOTMins = overtimeMins <= GRACE_MINS
        ? 0
        : Math.ceil((overtimeMins - GRACE_MINS) / OT_BLOCK_MINS) * OT_BLOCK_MINS;
    }

    const scheduledAmount = Math.round((scheduledMins / 60) * item.rate_per_hour * 100) / 100;
    const overtimeAmount  = Math.round((billedOTMins  / 60) * item.rate_per_hour * 100) / 100;
    const amount          = scheduledAmount + overtimeAmount;

    tableLines.push({
      id: item.id,
      label: `Table session`,
      durationMins,
      scheduledMins,
      overtimeMins,
      billedOTMins,
      ratePerHour: item.rate_per_hour,
      amount,
      scheduledAmount,
      overtimeAmount,
    });
  }

  const extraLines: ExtraLineItem[] = extras
    .filter((e) => !e.is_deleted)
    .map((e) => ({
      id: e.id,
      name: e.name,
      price: e.price,
      quantity: e.quantity,
      amount: Math.round(e.price * e.quantity * 100) / 100,
    }));

  const sessionTotal = Math.round(tableLines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
  const extraTotal   = Math.round(extraLines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
  const subtotal     = Math.round((sessionTotal + extraTotal) * 100) / 100;

  const scheduledSubtotal = Math.round(
    tableLines.reduce((sum, l) => sum + l.scheduledAmount, 0) * 100
  ) / 100;

  // Advance deducted from scheduled session cost (fixed, known at booking time).
  // Overtime accrues on top of that — not absorbed by the advance.
  // Walk-ins have no advance so this path just returns the live elapsed cost.
  const overtimeTotal = Math.max(0, sessionTotal - scheduledSubtotal);
  const netSessionDue = advancePaid > 0
    ? Math.max(0, scheduledSubtotal - advancePaid) + overtimeTotal
    : sessionTotal;

  let discountAmount = 0;
  if (coupon) {
    if (coupon.discount_type === "percent") {
      discountAmount = Math.round((subtotal * coupon.discount_value) / 100 * 100) / 100;
    } else {
      discountAmount = coupon.discount_value;
    }
    discountAmount = Math.min(discountAmount, subtotal);
  }

  const totalDue = Math.max(0, netSessionDue + extraTotal - discountAmount);

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
