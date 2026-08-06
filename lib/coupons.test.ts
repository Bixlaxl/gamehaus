import { describe, it, expect } from "vitest";
import { isSlotInCouponTimeWindow, formatFriendlyTime, isSlotOnCouponDays, formatFriendlyDays } from "./coupons";

describe("Coupon Time Window Validation", () => {
  it("should return true for Full Day coupons (null/empty time window)", () => {
    expect(isSlotInCouponTimeWindow("14:00", "16:00", null, null)).toBe(true);
    expect(isSlotInCouponTimeWindow("14:00", "16:00", "", "")).toBe(true);
  });

  it("should return true when slot is inside Happy Hours window (13:00 to 18:00)", () => {
    // 2 PM to 4 PM (14:00 - 16:00) inside 1 PM to 6 PM (13:00 - 18:00)
    expect(isSlotInCouponTimeWindow("14:00", "16:00", "13:00", "18:00")).toBe(true);
    expect(isSlotInCouponTimeWindow("13:00", "18:00", "13:00", "18:00")).toBe(true);
  });

  it("should return false when slot is outside Happy Hours window (13:00 to 18:00)", () => {
    // 7 PM to 8 PM (19:00 - 20:00) outside 1 PM to 6 PM
    expect(isSlotInCouponTimeWindow("19:00", "20:00", "13:00", "18:00")).toBe(false);
    // 10 AM to 12 PM (10:00 - 12:00) outside 1 PM to 6 PM
    expect(isSlotInCouponTimeWindow("10:00", "12:00", "13:00", "18:00")).toBe(false);
  });

  it("should format time to friendly 12-hour strings", () => {
    expect(formatFriendlyTime("13:00")).toBe("1:00 PM");
    expect(formatFriendlyTime("18:00")).toBe("6:00 PM");
    expect(formatFriendlyTime("09:30")).toBe("9:30 AM");
  });
});

describe("Coupon Day-of-Week Validation", () => {
  // Aug 10, 2026 is a Monday (1)
  // Aug 11, 2026 is a Tuesday (2)
  // Aug 14, 2026 is a Friday (5)
  // Aug 15, 2026 is a Saturday (6)
  // Aug 16, 2026 is a Sunday (0)

  it("should return true when slot is on allowed days", () => {
    // Mon-Thu coupon (1, 2, 3, 4) booked for Monday Aug 10
    const slotMonday = "2026-08-10T14:30:00+05:30";
    expect(isSlotOnCouponDays(slotMonday, [1, 2, 3, 4])).toBe(true);

    // Tuesday Aug 11
    const slotTuesday = "2026-08-11T16:00:00+05:30";
    expect(isSlotOnCouponDays(slotTuesday, [1, 2, 3, 4])).toBe(true);
  });

  it("should return false when slot is on restricted days", () => {
    // Mon-Thu coupon booked for Friday Aug 14
    const slotFriday = "2026-08-14T14:30:00+05:30";
    expect(isSlotOnCouponDays(slotFriday, [1, 2, 3, 4])).toBe(false);

    // Mon-Thu coupon booked for Sunday Aug 16
    const slotSunday = "2026-08-16T10:00:00+05:30";
    expect(isSlotOnCouponDays(slotSunday, [1, 2, 3, 4])).toBe(false);
  });

  it("should return true when valid_days is null or empty", () => {
    const slotFriday = "2026-08-14T14:30:00+05:30";
    expect(isSlotOnCouponDays(slotFriday, null)).toBe(true);
    expect(isSlotOnCouponDays(slotFriday, [])).toBe(true);
  });

  it("should format days array to friendly strings", () => {
    expect(formatFriendlyDays([1, 2, 3, 4])).toBe("Monday to Thursday");
    expect(formatFriendlyDays([1, 3])).toBe("Monday, Wednesday");
    expect(formatFriendlyDays(null)).toBe("All Days");
  });
});

