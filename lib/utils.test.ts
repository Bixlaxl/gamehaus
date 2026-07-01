import { describe, it, expect } from "vitest";
import { getActualSlotDate } from "./utils";

describe("getActualSlotDate", () => {
  it("should return the same date for daytime operating hours (no midnight crossing)", () => {
    // Opening: 10:00 AM, Closing: 10:00 PM (22:00)
    const baseDate = "2026-07-01";
    expect(getActualSlotDate(baseDate, "10:00", "10:00", "22:00")).toBe("2026-07-01");
    expect(getActualSlotDate(baseDate, "14:30", "10:00", "22:00")).toBe("2026-07-01");
    expect(getActualSlotDate(baseDate, "21:45", "10:00", "22:00")).toBe("2026-07-01");
  });

  it("should shift the date to the next day for slots after 12:00 AM in a midnight-crossing schedule", () => {
    // Opening: 4:00 PM (16:00), Closing: 2:00 AM (02:00)
    const baseDate = "2026-07-01";
    // Before midnight -> same day
    expect(getActualSlotDate(baseDate, "16:00", "16:00", "02:00")).toBe("2026-07-01");
    expect(getActualSlotDate(baseDate, "23:45", "16:00", "02:00")).toBe("2026-07-01");
    // After midnight -> next day
    expect(getActualSlotDate(baseDate, "00:00", "16:00", "02:00")).toBe("2026-07-02");
    expect(getActualSlotDate(baseDate, "01:30", "16:00", "02:00")).toBe("2026-07-02");
  });

  it("should support date shifting with month boundary transition correctly", () => {
    // Opening: 6:00 PM (18:00), Closing: 4:00 AM (04:00)
    // baseDate is the last day of July (31 days)
    const baseDate = "2026-07-31";
    // Before midnight -> same day
    expect(getActualSlotDate(baseDate, "18:00", "18:00", "04:00")).toBe("2026-07-31");
    // After midnight -> August 1st
    expect(getActualSlotDate(baseDate, "01:00", "18:00", "04:00")).toBe("2026-08-01");
  });
});
