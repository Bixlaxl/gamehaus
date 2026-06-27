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
  return t === "ps5" || t === "simulator" || table.name.toLowerCase().includes("simulator");
}

export function isSimulatorTable(table: { name: string; type: string }): boolean {
  const t = table.type as string;
  return t === "simulator" || table.name.toLowerCase().includes("simulator");
}

export type OccupiedConsoleItem = {
  tableId: string;
  numPeople?: number | null;
};

export function getSimulatorTotalCapacity(allTables: Array<{ id: string; name: string; type: string; people_pricing?: Record<string, unknown> | null }>): number {
  const simTables = allTables.filter(t => isSimulatorTable(t));
  if (simTables.length === 0) return 2;
  let capacity = 0;
  for (const st of simTables) {
    if (st.people_pricing && typeof st.people_pricing === "object" && st.people_pricing !== null) {
      const keys = Object.keys(st.people_pricing).filter(k => Boolean(st.people_pricing![k]));
      if (keys.length > 0) {
        capacity += keys.length;
        continue;
      }
    }
    capacity += 2;
  }
  return Math.max(2, capacity);
}

export function checkConsolePoolConflict({
  reqTableId,
  reqNumPeople = 1,
  allTables,
  occupiedItems,
}: {
  reqTableId: string;
  reqNumPeople?: number;
  allTables: Array<{ id: string; name: string; type: string; people_pricing?: Record<string, unknown> | null }>;
  occupiedItems: Array<string | OccupiedConsoleItem>;
}): boolean {
  const reqTable = allTables.find(t => t.id === reqTableId);
  if (!reqTable) return false;
  if (!isConsoleTable(reqTable)) return false;

  // Normalize occupiedItems to object format
  const normalizedItems: OccupiedConsoleItem[] = occupiedItems.map(item =>
    typeof item === "string" ? { tableId: item, numPeople: 1 } : item
  );

  // Standalone PS5 consoles count (type === 'ps5' and not simulator)
  const standalonePs5Tables = allTables.filter(t => (t.type as string) === "ps5" && !t.name.toLowerCase().includes("simulator"));
  const totalPs5Consoles = Math.max(2, standalonePs5Tables.length);

  // Total physical Simulator capacity based on registered controller rates in owner portal
  const totalSimulatorsCapacity = getSimulatorTotalCapacity(allTables);

  let ps5ConsolesUsed = 0;
  let simulatorsUsed = 0;

  for (const item of normalizedItems) {
    const occTable = allTables.find(t => t.id === item.tableId);
    if (!occTable) continue;
    if (isSimulatorTable(occTable)) {
      const nPeople = Math.max(1, Number(item.numPeople) || 1);
      simulatorsUsed += nPeople;
      ps5ConsolesUsed += nPeople;
    } else if (isConsoleTable(occTable)) {
      ps5ConsolesUsed += 1;
    }
  }

  const remPs5Consoles = totalPs5Consoles - ps5ConsolesUsed;
  const remSimulators = totalSimulatorsCapacity - simulatorsUsed;

  const reqIsSim = isSimulatorTable(reqTable);
  const neededSim = reqIsSim ? Math.max(1, Number(reqNumPeople) || 1) : 1;
  const neededPs5 = neededSim;

  if (reqIsSim) {
    if (remSimulators < neededSim) return true;
    if (remPs5Consoles < neededPs5) return true;
    return false;
  } else {
    if (normalizedItems.some(item => item.tableId === reqTableId)) {
      return true;
    }
    if (remPs5Consoles < 1) return true;
    return false;
  }
}






