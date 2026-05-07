import { describe, it, expect } from "vitest";
import { calculateBill } from "./engine";
import type { OrderItem, OrderExtra, Coupon } from "@/lib/supabase/types";

function makeItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: "item-1",
    order_id: "order-1",
    table_id: "table-1",
    status: "finished",
    scheduled_start: null,
    scheduled_end: null,
    scheduled_duration_mins: null,
    actual_start: null,
    actual_end: null,
    expected_end: null,
    extended_mins: 0,
    rate_per_hour: 60,
    final_amount: null,
    is_deleted: false,
    deleted_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeExtra(overrides: Partial<OrderExtra> = {}): OrderExtra {
  return {
    id: "extra-1",
    order_id: "order-1",
    name: "Red Bull",
    price: 100,
    quantity: 1,
    is_deleted: false,
    deleted_at: null,
    added_by: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: "coupon-1",
    location_id: null,
    code: "TEST",
    discount_type: "percent",
    discount_value: 20,
    valid_from: new Date().toISOString(),
    valid_until: new Date(Date.now() + 86400000).toISOString(),
    max_uses: null,
    used_count: 0,
    is_active: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const t0 = new Date("2024-01-01T10:00:00Z");
const t90 = new Date("2024-01-01T11:30:00Z"); // 90 mins later
const t60 = new Date("2024-01-01T11:00:00Z"); // 60 mins later

describe("billing engine", () => {
  it("overtime billing — 90-min session on ₹60/hr rate = ₹90", () => {
    const item = makeItem({
      actual_start: t0.toISOString(),
      actual_end: t90.toISOString(),
      rate_per_hour: 60,
      status: "finished",
    });
    const result = calculateBill([item], [], t90);
    expect(result.tableLines[0].durationMins).toBe(90);
    expect(result.tableLines[0].amount).toBeCloseTo(90, 1);
    expect(result.subtotal).toBeCloseTo(90, 1);
    expect(result.totalDue).toBeCloseTo(90, 1);
  });

  it("coupon percent — 20% off on ₹1000 subtotal = ₹800 due", () => {
    const item = makeItem({
      actual_start: t0.toISOString(),
      actual_end: new Date("2024-01-01T10:10:00Z").toISOString(), // 10 mins
      rate_per_hour: 6000, // ₹1000 for 10 mins
      status: "finished",
    });
    const coupon = makeCoupon({ discount_type: "percent", discount_value: 20 });
    const result = calculateBill([item], [], new Date(), coupon);
    expect(result.subtotal).toBeCloseTo(1000, 0);
    expect(result.discountAmount).toBeCloseTo(200, 0);
    expect(result.totalDue).toBeCloseTo(800, 0);
  });

  it("coupon flat — ₹100 off on ₹1000 subtotal = ₹900 due", () => {
    const item = makeItem({
      actual_start: t0.toISOString(),
      actual_end: new Date("2024-01-01T10:10:00Z").toISOString(),
      rate_per_hour: 6000,
      status: "finished",
    });
    const coupon = makeCoupon({ discount_type: "flat", discount_value: 100 });
    const result = calculateBill([item], [], new Date(), coupon);
    expect(result.discountAmount).toBe(100);
    expect(result.totalDue).toBeCloseTo(900, 0);
  });

  it("advance deduction — ₹100 advance on ₹800 total = ₹700 due", () => {
    const item = makeItem({
      actual_start: t0.toISOString(),
      actual_end: t60.toISOString(),
      rate_per_hour: 800,
      status: "finished",
    });
    const result = calculateBill([item], [], new Date(), null, 100);
    expect(result.subtotal).toBeCloseTo(800, 0);
    expect(result.advancePaid).toBe(100);
    expect(result.totalDue).toBeCloseTo(700, 0);
  });

  it("multiple tables simultaneously", () => {
    const item1 = makeItem({
      id: "i1",
      actual_start: t0.toISOString(),
      actual_end: t60.toISOString(),
      rate_per_hour: 60,
      status: "finished",
    });
    const item2 = makeItem({
      id: "i2",
      table_id: "table-2",
      actual_start: t0.toISOString(),
      actual_end: t60.toISOString(),
      rate_per_hour: 120,
      status: "finished",
    });
    const result = calculateBill([item1, item2], [], new Date());
    expect(result.tableLines).toHaveLength(2);
    expect(result.subtotal).toBeCloseTo(180, 1);
  });

  it("zero duration edge case — session started and stopped immediately", () => {
    const now = new Date("2024-01-01T10:00:00Z");
    const item = makeItem({
      actual_start: now.toISOString(),
      actual_end: now.toISOString(),
      rate_per_hour: 60,
      status: "finished",
    });
    const result = calculateBill([item], [], now);
    // ceil(0/60000) = 0, but let's verify no crash and amount is 0
    expect(result.tableLines[0].durationMins).toBe(0);
    expect(result.tableLines[0].amount).toBe(0);
    expect(result.totalDue).toBe(0);
  });

  it("still-running session — end uses 'now'", () => {
    const start = new Date("2024-01-01T10:00:00Z");
    const nowTime = new Date("2024-01-01T10:30:00Z"); // 30 mins later
    const item = makeItem({
      actual_start: start.toISOString(),
      actual_end: null,
      rate_per_hour: 60,
      status: "running",
    });
    const result = calculateBill([item], [], nowTime);
    expect(result.tableLines[0].durationMins).toBe(30);
    expect(result.tableLines[0].amount).toBeCloseTo(30, 1);
    expect(result.totalDue).toBeCloseTo(30, 1);
  });

  it("extras are included in subtotal", () => {
    const item = makeItem({
      actual_start: t0.toISOString(),
      actual_end: t60.toISOString(),
      rate_per_hour: 60,
      status: "finished",
    });
    const extra = makeExtra({ price: 100, quantity: 2 });
    const result = calculateBill([item], [extra], new Date());
    expect(result.extraLines[0].amount).toBe(200);
    expect(result.subtotal).toBeCloseTo(260, 1);
  });

  it("discount is capped at subtotal — flat coupon larger than bill", () => {
    const item = makeItem({
      actual_start: t0.toISOString(),
      actual_end: new Date("2024-01-01T10:01:00Z").toISOString(), // 1 min
      rate_per_hour: 60,
      status: "finished",
    });
    const coupon = makeCoupon({ discount_type: "flat", discount_value: 999 });
    const result = calculateBill([item], [], new Date(), coupon);
    expect(result.discountAmount).toBeLessThanOrEqual(result.subtotal);
    expect(result.totalDue).toBe(0);
  });
});
