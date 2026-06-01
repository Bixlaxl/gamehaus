"use client";

import { useEffect, useState } from "react";

/**
 * Lightweight clock that ticks at a configurable interval — typically 10s
 * or 30s — for components that need a fresh "now" but not per-second
 * precision. Cheaper than subscribing to the global 1Hz POS clock because
 * those subscribers re-render 60× per minute even when nothing visible
 * changes for 30 of those ticks.
 *
 * Use this in forms (walk-in panel, walk-in slider) and coarse countdowns
 * (booked-card "in N min" labels) where per-second updates are wasted.
 *
 * For live timers / billing previews keep using the global POS clock —
 * that's what it's there for.
 */
export function useNowSampled(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
