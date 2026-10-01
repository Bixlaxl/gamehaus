export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface DayOperatingHours {
  open: string;
  close: string;
}

export type WeekOperatingHours = {
  [K in DayKey]?: DayOperatingHours;
};

export const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DAY_NAMES: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/**
 * Returns DayKey ("mon" | "tue" | ... | "sun") for a given date in specified timezone.
 */
export function getDayKey(dateInput: Date | string = new Date(), timezone: string = "Asia/Kolkata"): DayKey {
  try {
    const d = typeof dateInput === "string" ? new Date(dateInput.includes("T") ? dateInput : `${dateInput}T12:00:00Z`) : dateInput;
    const short = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" })
      .format(d)
      .toLowerCase();
    
    if (short.startsWith("mon")) return "mon";
    if (short.startsWith("tue")) return "tue";
    if (short.startsWith("wed")) return "wed";
    if (short.startsWith("thu")) return "thu";
    if (short.startsWith("fri")) return "fri";
    if (short.startsWith("sat")) return "sat";
    return "sun";
  } catch {
    return "mon";
  }
}

/**
 * Standardize time string to "HH:MM" (e.g. "13:00:00" -> "13:00")
 */
export function normalizeTimeStr(t: string | null | undefined, fallback: string = "10:00"): string {
  if (!t) return fallback;
  const parts = t.trim().split(":");
  if (parts.length >= 2) {
    return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
  }
  return fallback;
}

/**
 * Resolves the operating hours (opening_time, closing_time) for a location on a specific date.
 * First checks day-specific override in location.operating_hours.
 * Falls back to default location.opening_time / location.closing_time.
 */
export function getLocationOperatingHours(
  location: {
    id?: string;
    opening_time?: string | null;
    closing_time?: string | null;
    operating_hours?: WeekOperatingHours | null;
    timezone?: string;
  } | null | undefined,
  dateInput: Date | string = new Date()
): { opening_time: string; closing_time: string } {
  const fallbackOpen = normalizeTimeStr(location?.opening_time, "10:00");
  const fallbackClose = normalizeTimeStr(location?.closing_time, "23:00");

  if (!location) {
    return { opening_time: fallbackOpen, closing_time: fallbackClose };
  }

  const dayKey = getDayKey(dateInput, location.timezone || "Asia/Kolkata");
  const daySchedule = location.operating_hours?.[dayKey];

  if (daySchedule && daySchedule.open && daySchedule.close) {
    return {
      opening_time: normalizeTimeStr(daySchedule.open, fallbackOpen),
      closing_time: normalizeTimeStr(daySchedule.close, fallbackClose),
    };
  }

  return { opening_time: fallbackOpen, closing_time: fallbackClose };
}
