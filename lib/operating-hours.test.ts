import { describe, it, expect } from "vitest";
import { getLocationOperatingHours, getDayKey, isWithinOperatingHours, isWeekendOperatingSlot } from "./operating-hours";

describe("getLocationOperatingHours", () => {
  const nerfTurfLocation = {
    id: "loc-nerf-turf",
    opening_time: "11:00",
    closing_time: "23:30",
    timezone: "Asia/Kolkata",
    operating_hours: {
      mon: { open: "11:00", close: "23:30" },
      tue: { open: "11:00", close: "23:30" },
      wed: { open: "11:00", close: "23:30" },
      thu: { open: "11:00", close: "23:30" },
      fri: { open: "11:00", close: "01:00" },
      sat: { open: "11:00", close: "01:00" },
      sun: { open: "11:00", close: "01:00" },
    },
  };

  it("resolves Thursday closing to 23:30", () => {
    // 2026-10-01 is a Thursday
    expect(getDayKey("2026-10-01")).toBe("thu");
    const hours = getLocationOperatingHours(nerfTurfLocation, "2026-10-01");
    expect(hours.opening_time).toBe("11:00");
    expect(hours.closing_time).toBe("23:30");
  });

  it("resolves Friday closing to 01:00 (extended weekend hours)", () => {
    // 2026-10-02 is a Friday
    expect(getDayKey("2026-10-02")).toBe("fri");
    const hours = getLocationOperatingHours(nerfTurfLocation, "2026-10-02");
    expect(hours.opening_time).toBe("11:00");
    expect(hours.closing_time).toBe("01:00");
  });

  it("resolves Saturday closing to 01:00", () => {
    // 2026-10-03 is a Saturday
    expect(getDayKey("2026-10-03")).toBe("sat");
    const hours = getLocationOperatingHours(nerfTurfLocation, "2026-10-03");
    expect(hours.opening_time).toBe("11:00");
    expect(hours.closing_time).toBe("01:00");
  });

  it("resolves Monday closing to 23:30", () => {
    // 2026-10-05 is a Monday
    expect(getDayKey("2026-10-05")).toBe("mon");
    const hours = getLocationOperatingHours(nerfTurfLocation, "2026-10-05");
    expect(hours.opening_time).toBe("11:00");
    expect(hours.closing_time).toBe("23:30");
  });

  it("falls back to default opening and closing time if operating_hours is empty or null", () => {
    const defaultOnlyLocation = {
      opening_time: "13:00",
      closing_time: "03:00",
      operating_hours: null,
    };
    const hours = getLocationOperatingHours(defaultOnlyLocation, "2026-10-02");
    expect(hours.opening_time).toBe("13:00");
    expect(hours.closing_time).toBe("03:00");
  });
});

describe("isWithinOperatingHours", () => {
  it("allows slots within normal same-day hours (11:00 to 23:30)", () => {
    // 22:00 to 23:00 on Thursday 2026-10-01
    const start = new Date("2026-10-01T22:00:00+05:30").toISOString();
    const end = new Date("2026-10-01T23:00:00+05:30").toISOString();
    expect(isWithinOperatingHours(start, end, "11:00", "23:30")).toBe(true);

    // 23:00 to 23:30 (exactly reaches closing)
    const endAtClose = new Date("2026-10-01T23:30:00+05:30").toISOString();
    expect(isWithinOperatingHours(end, endAtClose, "11:00", "23:30")).toBe(true);
  });

  it("rejects slots exceeding closing time on normal same-day hours", () => {
    // 23:00 to 23:45 on Thursday (closes at 23:30)
    const start = new Date("2026-10-01T23:00:00+05:30").toISOString();
    const end = new Date("2026-10-01T23:45:00+05:30").toISOString();
    expect(isWithinOperatingHours(start, end, "11:00", "23:30")).toBe(false);
  });

  it("allows slots past midnight when closing is 01:00 next day", () => {
    // Friday night into Saturday morning: 23:30 (Friday) to 00:30 (Saturday)
    const startBeforeMidnight = new Date("2026-10-02T23:30:00+05:30").toISOString();
    const endAfterMidnight = new Date("2026-10-03T00:30:00+05:30").toISOString();
    expect(isWithinOperatingHours(startBeforeMidnight, endAfterMidnight, "11:00", "01:00")).toBe(true);

    // 00:00 (Saturday) to 01:00 (Saturday) — belongs to Friday night's shift closing at 01:00
    const startPostMidnight = new Date("2026-10-03T00:00:00+05:30").toISOString();
    const endPostMidnight = new Date("2026-10-03T01:00:00+05:30").toISOString();
    expect(isWithinOperatingHours(startPostMidnight, endPostMidnight, "11:00", "01:00")).toBe(true);
  });

  it("rejects slots past 01:00 when closing is 01:00 next day", () => {
    // 00:30 to 01:15 on Saturday morning
    const start = new Date("2026-10-03T00:30:00+05:30").toISOString();
    const end = new Date("2026-10-03T01:15:00+05:30").toISOString();
    expect(isWithinOperatingHours(start, end, "11:00", "01:00")).toBe(false);
  });
});

describe("isWeekendOperatingSlot", () => {
  it("identifies standard weekday afternoon slots as non-weekend", () => {
    // Friday afternoon at 14:00 IST
    const fridaySlot = new Date("2026-10-02T14:00:00+05:30").toISOString();
    expect(isWeekendOperatingSlot(fridaySlot, "11:00")).toBe(false);

    // Monday afternoon at 15:00 IST
    const mondaySlot = new Date("2026-10-05T15:00:00+05:30").toISOString();
    expect(isWeekendOperatingSlot(mondaySlot, "11:00")).toBe(false);
  });

  it("identifies Friday post-midnight slots (Saturday 00:30 IST) as Friday weekday shift", () => {
    // Friday night into Saturday 00:30 IST — belongs to Friday's 11:00 AM operating day
    const fridayNightPostMidnight = new Date("2026-10-03T00:30:00+05:30").toISOString();
    expect(isWeekendOperatingSlot(fridayNightPostMidnight, "11:00")).toBe(false);
  });

  it("identifies Saturday daytime and evening slots as weekend", () => {
    // Saturday afternoon at 15:00 IST
    const saturdayDaySlot = new Date("2026-10-03T15:00:00+05:30").toISOString();
    expect(isWeekendOperatingSlot(saturdayDaySlot, "11:00")).toBe(true);

    // Saturday evening at 21:00 IST
    const saturdayNightSlot = new Date("2026-10-03T21:00:00+05:30").toISOString();
    expect(isWeekendOperatingSlot(saturdayNightSlot, "11:00")).toBe(true);
  });

  it("identifies Sunday daytime and Sunday post-midnight slots as weekend", () => {
    // Sunday afternoon at 16:00 IST
    const sundayDaySlot = new Date("2026-10-04T16:00:00+05:30").toISOString();
    expect(isWeekendOperatingSlot(sundayDaySlot, "11:00")).toBe(true);

    // Sunday night into Monday 00:30 IST — belongs to Sunday's operating day!
    const sundayNightPostMidnight = new Date("2026-10-05T00:30:00+05:30").toISOString();
    expect(isWeekendOperatingSlot(sundayNightPostMidnight, "11:00")).toBe(true);
  });
});
