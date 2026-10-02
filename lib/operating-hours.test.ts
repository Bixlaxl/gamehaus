import { describe, it, expect } from "vitest";
import { getLocationOperatingHours, getDayKey } from "./operating-hours";

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
