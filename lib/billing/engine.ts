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

    // Billing is slot-based: charge is locked to the booked slot (expected_end - actual_start).
    // Stopping early does not reduce the bill. Extensions move expected_end forward.
    // No per-minute ticking, no overtime blocks — sessions auto-stop within the 2-min grace.
    const billingEnd = item.expected_end
      ? new Date(item.expected_end)
      : item.actual_end
      ? new Date(item.actual_end)
      : now; // fallback: session started but expected_end not yet set

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
