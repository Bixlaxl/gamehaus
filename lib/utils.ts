import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Compute the active shop-day window from "HH:MM" opening + closing times.
 * Handles midnight-crossing locations (e.g. opens 10:00, closes 02:00 next day).
 *
 * Used by both PanelWalkIn (in-panel form) and the POS header walk-in button
 * to gate walk-ins outside operating hours. Server-side /api/walkin replays
 * the same logic as the final guard.
 */
export function getShopWindow(now: Date, openingTime: string, closingTime: string) {
  const [oh, om] = openingTime.split(":").map(Number);
  const [ch, cm] = closingTime.split(":").map(Number);
  const crossesMidnight = (ch * 60 + cm) <= (oh * 60 + om);

  const opensToday  = new Date(now); opensToday.setHours(oh, om, 0, 0);
  const closesToday = new Date(now); closesToday.setHours(ch, cm, 0, 0);

  let opensMs:  number;
  let closesMs: number;
  if (!crossesMidnight) {
    opensMs  = opensToday.getTime();
    closesMs = closesToday.getTime();
  } else {
    // Midnight-cross: are we in the post-midnight overnight portion?
    const nowMinsOfDay   = now.getHours() * 60 + now.getMinutes();
    const closeMinsOfDay = ch * 60 + cm;
    if (nowMinsOfDay < closeMinsOfDay) {
      // Overnight portion: shop opened yesterday, closes today.
      opensMs  = opensToday.getTime() - 24 * 60 * 60 * 1000;
      closesMs = closesToday.getTime();
    } else {
      // Daytime portion: shop opens today, closes tomorrow.
      opensMs  = opensToday.getTime();
      closesMs = closesToday.getTime() + 24 * 60 * 60 * 1000;
    }
  }

  const nowMs        = now.getTime();
  const beforeOpen   = nowMs < opensMs;
  const afterClose   = nowMs >= closesMs;
  const outsideHours = beforeOpen || afterClose;
  const minsUntilClose = Math.max(0, Math.floor((closesMs - nowMs) / 60000));

  return { opensMs, closesMs, beforeOpen, afterClose, outsideHours, minsUntilClose };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatElapsed(startTime: Date, now: Date): string {
  const diffMs = now.getTime() - startTime.getTime();
  if (diffMs <= 0) return "00:00";
  const totalSecs = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatCountdown(endTime: Date, now: Date): string {
  const diffMs = endTime.getTime() - now.getTime();
  if (diffMs <= 0) return "00:00";
  const totalSecs = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Signed countdown — negative when `now` has passed `endTime`. Returns e.g. "-05:23". */
export function formatSignedCountdown(endTime: Date, now: Date): { text: string; isOvertime: boolean } {
  const diffMs    = endTime.getTime() - now.getTime();
  const isOvertime = diffMs < 0;
  const absMs     = Math.abs(diffMs);
  const totalSecs = Math.floor(absMs / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const body = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return { text: isOvertime ? `-${body}` : body, isOvertime };
}

export function isConsoleTable(table: { name: string; type: string }): boolean {
  const t = table.type as string;
  return t === "ps5" || t === "ps5_simulator" || t === "simulator" || table.name.toLowerCase().includes("simulator");
}

/** True for the new unified "PS5 & Simulator" table type */
export function isPsSimulatorTable(table: { name?: string; type: string }): boolean {
  return (table.type as string) === "ps5_simulator";
}

/** @deprecated — kept for backward compat with old "ps5" or "simulator"-named tables */
export function isSimulatorTable(table: { name: string; type: string }): boolean {
  const t = table.type as string;
  return t === "simulator" || table.name.toLowerCase().includes("simulator");
}

/**
 * Returns true ONLY if the active table or selected mode is specifically a Simulator.
 * If a mode is selected (e.g. PS5 mode on a PS5 & Simulator table), checks ONLY the mode name.
 */
export function isSimulatorActive(
  table: { name?: string; type: string } | null | undefined,
  selectedMode?: { name?: string } | null | undefined
): boolean {
  if (!table) return false;
  if (selectedMode?.name) {
    return selectedMode.name.toLowerCase().includes("simulator");
  }
  return (table.type as string) === "simulator" || (table.type !== "ps5_simulator" && table.name?.toLowerCase().includes("simulator") === true);
}

export function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  return [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, "0"),
    String(next.getDate()).padStart(2, "0"),
  ].join("-");
}

export function getActualSlotDate(baseDate: string, timeStr: string, opening: string = "10:00", closing: string = "23:00"): string {
  const [oh, om] = opening.split(":").map(Number);
  const [ch, cm] = closing.split(":").map(Number);
  const openMins  = oh * 60 + om;
  const closeMins = ch * 60 + cm;
  const crossesMidnight = closeMins < openMins;

  const [sh, sm] = timeStr.split(":").map(Number);
  const slotMins = sh * 60 + sm;

  if (crossesMidnight && slotMins < openMins) {
    return addOneDay(baseDate);
  }
  return baseDate;
}



