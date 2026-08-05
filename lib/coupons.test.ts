import { describe, it, expect } from "vitest";
import { isSlotInCouponTimeWindow, formatFriendlyTime } from "./coupons";

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
