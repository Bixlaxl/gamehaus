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

export function getConsoleNumber(tableName: string): number | null {
  const normalized = tableName.toLowerCase();
  if (normalized.includes("1")) return 1;
  if (normalized.includes("2")) return 2;
  return null;
}

export function isPs5Conflict({
  reqTableId,
  reqTableName,
  reqTableType,
  reqNumPeople,
  exTableId,
  exTableName,
  exTableType,
  exNumPeople
}: {
  reqTableId: string;
  reqTableName: string;
  reqTableType: string;
  reqNumPeople: number;
  exTableId: string;
  exTableName: string;
  exTableType: string;
  exNumPeople: number;
}): boolean {
  if (reqTableId === exTableId) return true;
  if (reqTableType !== "ps5" || exTableType !== "ps5") return false;

  const reqConsole = getConsoleNumber(reqTableName);
  const exConsole = getConsoleNumber(exTableName);

  if (reqConsole === null || exConsole === null) return false;

  if (reqConsole === exConsole) return true;
  if (reqNumPeople >= 2 || exNumPeople >= 2) return true;

  return false;
}
