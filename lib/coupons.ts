/**
 * Helper to check if a booking slot (e.g. 14:00 - 16:00) falls within a coupon's time window (e.g. 13:00 - 18:00).
 * If validFromTime or validUntilTime is null/empty, returns true (Full Day Coupon).
 */
export function isSlotInCouponTimeWindow(
  slotStartIsoOrTime?: string | null,
  slotEndIsoOrTime?: string | null,
  validFromTime?: string | null,
  validUntilTime?: string | null
): boolean {
  if (!validFromTime || !validUntilTime) return true; // Full Day Coupon

  if (!slotStartIsoOrTime) return true; // Default allow if slot time not specified

  const parseTimeToMins = (tStr: string): number | null => {
    if (!tStr) return null;
    const clean = tStr.trim();
    if (clean.includes("T") || clean.includes("-")) {
      // ISO date string e.g. "2026-08-05T14:30:00+05:30"
      const d = new Date(clean);
      if (isNaN(d.getTime())) return null;
      // Convert to IST minutes from midnight
      const istTimeStr = d.toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata", hour12: false, hour: "2-digit", minute: "2-digit" });
      const [h, m] = istTimeStr.split(":").map(Number);
      return h * 60 + m;
    }
    // "13:00" or "01:00 PM"
    const match = clean.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
    if (!match) return null;
    let h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const ampm = match[3]?.toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return h * 60 + m;
  };

  const couponStartMins = parseTimeToMins(validFromTime);
  const couponEndMins = parseTimeToMins(validUntilTime);

  if (couponStartMins === null || couponEndMins === null) return true;

  const slotStartMins = parseTimeToMins(slotStartIsoOrTime);
  if (slotStartMins === null) return true;

  const slotEndMins = slotEndIsoOrTime ? parseTimeToMins(slotEndIsoOrTime) : slotStartMins + 60;

  if (slotStartMins < couponStartMins || (slotEndMins !== null && slotEndMins > couponEndMins)) {
    return false;
  }

  return true;
}

/**
 * Formats time string (e.g. "13:00") into friendly 12-hour format e.g. "1:00 PM".
 */
export function formatFriendlyTime(timeStr?: string | null): string {
  if (!timeStr) return "";
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return timeStr;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const ampmIn = match[3]?.toUpperCase();
  if (ampmIn) return `${h}:${m.toString().padStart(2, "0")} ${ampmIn}`;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * Returns the day of the week (0 = Sunday, 1 = Monday, etc.) for a slot start in Asia/Kolkata timezone.
 */
export function getSlotDayOfWeek(slotStartIso: string): number | null {
  try {
    const d = new Date(slotStartIso);
    if (isNaN(d.getTime())) return null;
    const dayName = d.toLocaleDateString("en-US", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
    });
    const daysMap: Record<string, number> = {
      Sunday: 0,
      Monday: 1,
      Tuesday: 2,
      Wednesday: 3,
      Thursday: 4,
      Friday: 5,
      Saturday: 6,
    };
    return daysMap[dayName] ?? null;
  } catch (e) {
    return null;
  }
}

/**
 * Checks if a slot's date falls on one of the coupon's valid days.
 * If validDays is null or empty, returns true (valid every day).
 */
export function isSlotOnCouponDays(
  slotStartIso?: string | null,
  validDays?: number[] | null
): boolean {
  if (!validDays || validDays.length === 0) return true; // Valid all days
  if (!slotStartIso) return true; // Fallback if slot start is not provided
  
  const dayOfWeek = getSlotDayOfWeek(slotStartIso);
  if (dayOfWeek === null) return true; // Fallback
  
  return validDays.includes(dayOfWeek);
}

/**
 * Formats valid days array into friendly display string e.g. "Monday to Thursday" or "Monday, Wednesday".
 */
export function formatFriendlyDays(validDays?: number[] | null): string {
  if (!validDays || validDays.length === 0) return "All Days";
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  
  // Sort days: Monday (1) to Sunday (0) by converting 0 to 7 temporarily for clean sorting if desired,
  // but standard ascending is fine.
  const sorted = [...validDays].sort((a, b) => a - b);
  
  // Check if it's a consecutive range (e.g. 1, 2, 3, 4)
  let consecutive = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i-1] + 1) {
      consecutive = false;
      break;
    }
  }
  
  if (consecutive && sorted.length > 2) {
    return `${dayNames[sorted[0]]} to ${dayNames[sorted[sorted.length - 1]]}`;
  }
  
  return sorted.map(d => dayNames[d]).join(", ");
}

