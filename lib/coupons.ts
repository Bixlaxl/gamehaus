/**
 * Helper to parse time strings into minutes from midnight (IST).
 */
export function parseTimeToMins(tStr?: string | null): number | null {
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
}

/**
 * Checks if a booking slot overlaps with a coupon's time window (e.g. 13:00 - 17:00).
 * If validFromTime or validUntilTime is null/empty, returns true (Full Day Coupon).
 */
export function isSlotInCouponTimeWindow(
  slotStartIsoOrTime?: string | null,
  slotEndIsoOrTime?: string | null,
  validFromTime?: string | null,
  validUntilTime?: string | null
): boolean {
  if (!validFromTime || !validUntilTime) return true; // Full Day Coupon
  if (!slotStartIsoOrTime) return true;

  const couponStartMins = parseTimeToMins(validFromTime);
  const couponEndMins   = parseTimeToMins(validUntilTime);
  if (couponStartMins === null || couponEndMins === null) return true;

  const slotStartMins = parseTimeToMins(slotStartIsoOrTime);
  if (slotStartMins === null) return true;

  const slotEndMins = slotEndIsoOrTime ? (parseTimeToMins(slotEndIsoOrTime) ?? (slotStartMins + 60)) : (slotStartMins + 60);

  // Checks if there is any positive overlap
  const overlapStart = Math.max(slotStartMins, couponStartMins);
  const overlapEnd   = Math.min(slotEndMins, couponEndMins);
  return overlapEnd > overlapStart;
}

export interface CouponDiscountResult {
  valid: boolean;
  reason?: string;
  discount_amount: number;
  overlap_minutes: number;
  total_minutes: number;
  is_prorated: boolean;
}

/**
 * Pure calculation function that calculates pro-rated coupon discount based on
 * Happy Hour time-window overlap and valid days of the week.
 */
export function calculateCouponDiscount(
  coupon: {
    discount_type: "percent" | "flat" | string;
    discount_value: number | string;
    valid_from_time?: string | null;
    valid_until_time?: string | null;
    valid_days?: number[] | null;
  },
  slotStartIsoOrTime?: string | null,
  slotEndIsoOrTime?: string | null,
  subtotal: number = 0
): CouponDiscountResult {
  const discountVal = Number(coupon.discount_value) || 0;

  // 1. Day of week check
  if (coupon.valid_days && coupon.valid_days.length > 0) {
    if (!isSlotOnCouponDays(slotStartIsoOrTime, coupon.valid_days)) {
      const daysFmt = formatFriendlyDays(coupon.valid_days);
      return {
        valid: false,
        reason: `This coupon is only valid on: ${daysFmt}`,
        discount_amount: 0,
        overlap_minutes: 0,
        total_minutes: 0,
        is_prorated: false,
      };
    }
  }

  // 2. Full Day Coupon (no time restrictions)
  if (!coupon.valid_from_time || !coupon.valid_until_time) {
    let discount = 0;
    if (subtotal > 0) {
      if (coupon.discount_type === "percent") {
        discount = Math.round((subtotal * discountVal) / 100 * 100) / 100;
      } else {
        discount = discountVal;
      }
      discount = Math.min(discount, subtotal);
    }
    return {
      valid: true,
      discount_amount: discount,
      overlap_minutes: 0,
      total_minutes: 0,
      is_prorated: false,
    };
  }

  // 3. Time Window / Happy Hours calculation
  const couponStartMins = parseTimeToMins(coupon.valid_from_time);
  const couponEndMins   = parseTimeToMins(coupon.valid_until_time);
  if (couponStartMins === null || couponEndMins === null) {
    let discount = 0;
    if (subtotal > 0) {
      discount = coupon.discount_type === "percent"
        ? Math.round((subtotal * discountVal) / 100 * 100) / 100
        : discountVal;
      discount = Math.min(discount, subtotal);
    }
    return { valid: true, discount_amount: discount, overlap_minutes: 0, total_minutes: 0, is_prorated: false };
  }

  const slotStartMins = parseTimeToMins(slotStartIsoOrTime);
  if (slotStartMins === null) {
    return { valid: true, discount_amount: 0, overlap_minutes: 0, total_minutes: 0, is_prorated: false };
  }

  const slotEndMins = slotEndIsoOrTime ? (parseTimeToMins(slotEndIsoOrTime) ?? (slotStartMins + 60)) : (slotStartMins + 60);
  const totalMins   = Math.max(1, slotEndMins - slotStartMins);

  // Compute overlapping minutes between [slotStartMins, slotEndMins] and [couponStartMins, couponEndMins]
  const overlapStart = Math.max(slotStartMins, couponStartMins);
  const overlapEnd   = Math.min(slotEndMins, couponEndMins);
  const overlapMins  = Math.max(0, overlapEnd - overlapStart);

  if (overlapMins <= 0) {
    const fromFmt = formatFriendlyTime(coupon.valid_from_time);
    const untilFmt = formatFriendlyTime(coupon.valid_until_time);
    return {
      valid: false,
      reason: `This coupon is only valid for slots booked between ${fromFmt} and ${untilFmt}`,
      discount_amount: 0,
      overlap_minutes: 0,
      total_minutes: totalMins,
      is_prorated: false,
    };
  }

  // Calculate pro-rated eligible amount for the happy hours overlap
  const overlapRatio = Math.min(1, overlapMins / totalMins);
  const eligibleAmount = subtotal * overlapRatio;
  let discount = 0;

  if (subtotal > 0) {
    if (coupon.discount_type === "percent") {
      discount = Math.round((eligibleAmount * discountVal) / 100 * 100) / 100;
    } else {
      // For flat discount, scale proportionally to the overlap
      discount = Math.round((discountVal * overlapRatio) * 100) / 100;
    }
    discount = Math.min(discount, eligibleAmount);
  }

  return {
    valid: true,
    discount_amount: discount,
    overlap_minutes: overlapMins,
    total_minutes: totalMins,
    is_prorated: overlapMins < totalMins,
  };
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
