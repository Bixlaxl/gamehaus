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
    num_people: null,
    is_deleted: false,
    deleted_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeExtra(overrides: Partial<OrderExtra> = {}): OrderExtra {
  return {
    id:                "extra-1",
    order_id:          "order-1",
    name:              "Red Bull",
    price:             100,
    cost_price:        0,
    quantity:          1,
    inventory_item_id: null,
    is_deleted:        false,
    deleted_at:        null,
    added_by:          null,
    created_at:        new Date().toISOString(),
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
    is_public: false,
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

  it("member discount stacks with public coupon and covers extra items", () => {
    const item = makeItem({
      actual_start: t0.toISOString(),
      actual_end: t60.toISOString(), // 60m
      rate_per_hour: 200, // ₹200 session
      status: "finished",
    });
    const extra = makeExtra({ price: 100, quantity: 1 }); // ₹100 extra
    const coupon = makeCoupon({ discount_type: "flat", discount_value: 30 }); // ₹30 public coupon
    // Pass 10% member discount (memberDiscountPct = 10)
    const result = calculateBill([item], [extra], new Date(), coupon, 0, 0, 10);
    // scheduledSubtotal = 200
    // publicDiscount = 30 -> remainingScheduled = 170
    // extraTotal = 100
    // memberDiscountableBase = 170 + 100 = 270
    // memberDiscountAmount = 10% of 270 = 27
    // totalDue = (200 - 30) + 100 - 27 = 243
    expect(result.discountAmount).toBe(30);
    expect(result.memberDiscountAmount).toBe(27);
    expect(result.totalDue).toBe(243);
  });

  it("no double-count: passing public_discount_amount (coupon-only) as fixedDiscount + live member % is correct", () => {
    // Scenario: online booking, 15% coupon + 10% member both applied at booking time.
    // At finalize, we pass publicDiscountAmount = coupon-only, and memberPct = 10% live.
    // Result should be SAME as if applied fresh — no double-count.
    const item = makeItem({
      actual_start: t0.toISOString(),
      actual_end: t60.toISOString(), // 60m
      rate_per_hour: 200, // ₹200 session
      status: "finished",
    });
    // publicDiscountAmount = 15% of 200 = 30 (coupon only)
    const publicDiscount = 30;
    const result = calculateBill([item], [], new Date(), null, 0, publicDiscount, 10);
    // scheduledSubtotal = 200
    // publicDiscount applied as fixedDiscountAmount = 30
    // remainingScheduled = 200 - 30 = 170
    // memberDiscountableBase = 170
    // memberDiscountAmount = 10% of 170 = 17
    // totalDue = 170 - 17 = 153
    expect(result.discountAmount).toBe(30);
    expect(result.memberDiscountAmount).toBeCloseTo(17, 0);
    expect(result.totalDue).toBeCloseTo(153, 0);
  });

  it("free hours + member % stack: 1hr free on 2hr session, then 10% member on remainder + extras", () => {
    // 2hr session at ₹100/hr = ₹200. 1hr free = ₹100 free hours discount.
    // Then 10% member on remaining ₹100 session + ₹50 extras = ₹15.
    // totalDue = 200 - 100 (free hrs) - 15 (member%) + 50 extras - 15 = 135? Let's compute carefully.
    const item = makeItem({
      actual_start: t0.toISOString(),
      actual_end: new Date("2024-01-01T12:00:00Z").toISOString(), // 2hr
      rate_per_hour: 100, // ₹200 session
      status: "finished",
    });
    const extra = makeExtra({ price: 50, quantity: 1 }); // ₹50 extra
    const freeHrsDiscount = 100; // 1hr free at ₹100/hr
    const result = calculateBill([item], [extra], new Date(), null, 0, 0, 10, freeHrsDiscount);
    // scheduledSubtotal = 200, extraTotal = 50
    // publicDiscount = 0, freeHrsDiscount = 100
    // remainingScheduledAfterPublic = 200
    // remainingScheduledAfterFree = 200 - 100 = 100
    // memberDiscountableBase = 100 (session remainder) + 0 (OT) + 50 (extras) = 150
    // memberDiscountAmount = 10% of 150 = 15
    // totalDue = 100 + 50 - 15 = 135
    expect(result.freeHoursDiscountAmount).toBe(100);
    expect(result.memberDiscountAmount).toBeCloseTo(15, 0);
    expect(result.totalDue).toBeCloseTo(135, 0);
  });

  it("public coupon does not spill over onto extras when free hours cover scheduled table", () => {
    // Session = 75 mins at ₹380/hr = ₹475. Scheduled = ₹380, Extension = ₹95.
    // Extras = ₹90. Total subtotal = ₹565.
    // Free hours covers ₹475 (or ₹380). If free hours covers ₹380 scheduled table,
    // public coupon of ₹57 (15%) cannot spill over onto extras/extension.
    const item = makeItem({
      actual_start: t0.toISOString(),
      actual_end: new Date("2024-01-01T11:15:00Z").toISOString(), // 75m
      rate_per_hour: 380,
      status: "finished",
    });
    const extra1 = makeExtra({ price: 70, quantity: 1 }); // ₹70
    const extra2 = makeExtra({ price: 20, quantity: 1 }); // ₹20
    const coupon = makeCoupon({ discount_type: "percent", discount_value: 15 }); // 15% = ₹57 on ₹380
    // When free hours cover ₹475 (full session including extension)
    const resultFullFree = calculateBill([item], [extra1, extra2], new Date(), coupon, 0, 0, 0, 475);
    // freeHoursDiscountAmount = 475, publicDiscount capped to 0 because scheduled net is 0
    expect(resultFullFree.freeHoursDiscountAmount).toBe(475);
    expect(resultFullFree.discountAmount).toBe(0);
    expect(resultFullFree.totalDue).toBe(90); // Only extras!
  });
});

