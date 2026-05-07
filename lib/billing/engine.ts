import type { OrderItem, OrderExtra, Coupon } from "@/lib/supabase/types";

export interface BillingLineItem {
  id: string;
  label: string;
  durationMins: number;
  ratePerHour: number;
  amount: number;
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
    const amount = (durationMins / 60) * item.rate_per_hour;

    tableLines.push({
      id: item.id,
      label: `Table session`,
      durationMins,
      ratePerHour: item.rate_per_hour,
      amount: Math.round(amount * 100) / 100,
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

  const subtotal =
    tableLines.reduce((sum, l) => sum + l.amount, 0) +
    extraLines.reduce((sum, l) => sum + l.amount, 0);

  let discountAmount = 0;
  if (coupon) {
    if (coupon.discount_type === "percent") {
      discountAmount = Math.round((subtotal * coupon.discount_value) / 100 * 100) / 100;
    } else {
      discountAmount = coupon.discount_value;
    }
    discountAmount = Math.min(discountAmount, subtotal);
  }

  const totalDue = Math.max(0, subtotal - discountAmount - advancePaid);

  return {
    tableLines,
    extraLines,
    subtotal: Math.round(subtotal * 100) / 100,
    discountAmount: Math.round(discountAmount * 100) / 100,
    advancePaid,
    totalDue: Math.round(totalDue * 100) / 100,
  };
}
