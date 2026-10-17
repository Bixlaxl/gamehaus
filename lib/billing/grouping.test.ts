import { describe, it, expect } from "vitest";
import { groupOrders, isScheduledBookingOrder } from "./grouping";
import type { POSOrder } from "@/store/pos";

describe("groupOrders and isScheduledBookingOrder", () => {
  it("identifies scheduled booking order correctly", () => {
    const scheduledOrder = {
      id: "order-1",
      customer_name: "Refaat",
      customer_phone: "9952028815",
      items: [
        {
          id: "item-1",
          status: "scheduled",
          actual_start: null,
          checked_in_at: null,
        },
      ],
    } as unknown as POSOrder;

    expect(isScheduledBookingOrder(scheduledOrder)).toBe(true);

    const runningOrder = {
      id: "order-2",
      customer_name: "Refaat",
      customer_phone: "9952028815",
      items: [
        {
          id: "item-2",
          status: "running",
          actual_start: "2026-10-15T10:00:00Z",
          checked_in_at: "2026-10-15T10:00:00Z",
        },
      ],
    } as unknown as POSOrder;

    expect(isScheduledBookingOrder(runningOrder)).toBe(false);
  });

  it("does not group a future scheduled booking with an active running order of the same customer", () => {
    const runningOrder = {
      id: "order-active",
      customer_name: "Refaat",
      customer_phone: "9952028815",
      created_at: "2026-10-15T11:20:00Z",
      items: [
        {
          id: "item-active",
          status: "running",
          actual_start: "2026-10-15T11:25:00Z",
          checked_in_at: "2026-10-15T11:25:00Z",
        },
      ],
      extras: [],
      subtotal: 300,
      discount_amount: 0,
      total_amount: 300,
      advance_paid: 0,
      points_redeemed: 0,
    } as unknown as POSOrder;

    const scheduledOrder = {
      id: "order-future",
      customer_name: "Refaat",
      customer_phone: "9952028815",
      created_at: "2026-10-15T08:52:00Z",
      items: [
        {
          id: "item-future",
          status: "scheduled",
          actual_start: null,
          checked_in_at: null,
        },
      ],
      extras: [],
      subtotal: 450,
      discount_amount: 45,
      total_amount: 405,
      advance_paid: 405,
      points_redeemed: 0,
    } as unknown as POSOrder;

    const grouped = groupOrders([runningOrder, scheduledOrder]);

    // They must NOT be merged into a single group
    expect(grouped.length).toBe(2);
    const activeGroup = grouped.find((g) => g.id === "order-active");
    const scheduledGroup = grouped.find((g) => g.id === "order-future");

    expect(activeGroup?.orderIds).toEqual(["order-active"]);
    expect(scheduledGroup?.orderIds).toEqual(["order-future"]);
    expect(activeGroup?.advance_paid).toBe(0);
    expect(scheduledGroup?.advance_paid).toBe(405);
  });
});
