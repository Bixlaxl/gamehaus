"use client";

import { useRef } from "react";
import { usePOSStore } from "@/store/pos";

export function POSAlerts() {
  const tables = usePOSStore((s) => s.tables);
  const now    = usePOSStore((s) => s.now);
  const beepedRef  = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);

  function beep() {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch { /* browser may block before user gesture */ }
  }

  const alerts: { id: string; short: string; full: string; type: "warning" | "urgent" }[] = [];

  for (const table of tables) {
    if (table.upcomingBooking) {
      const start  = new Date(table.upcomingBooking.scheduled_start);
      const diffMs = start.getTime() - now.getTime();

      if (diffMs > 0 && diffMs < 5 * 60 * 1000) {
        const mins = Math.ceil(diffMs / 60000);
        alerts.push({
          id:    `pre-${table.upcomingBooking.id}`,
          short: `${table.name} · ${table.upcomingBooking.order?.customer_name} · ${mins}m`,
          full:  `${table.name} — ${table.upcomingBooking.order?.customer_name} arriving in ${mins} min. Inform current player.`,
          type:  "warning",
        });
      }

      const heldUntil = new Date(table.upcomingBooking.held_until);
      if (now > heldUntil) {
        alerts.push({
          id:    `noshow-${table.upcomingBooking.id}`,
          short: `${table.upcomingBooking.order?.customer_name} · No-show?`,
          full:  `${table.upcomingBooking.order?.customer_name} (${table.name}) not arrived — Mark No-Show?`,
          type:  "urgent",
        });
      }
    }

    if (table.activeOrderItem?.expected_end) {
      const end     = new Date(table.activeOrderItem.expected_end);
      const diffMs  = end.getTime() - now.getTime();
      const alertId = `5min-${table.activeOrderItem.id}`;

      if (diffMs > 0 && diffMs < 5 * 60 * 1000) {
        const mins = Math.ceil(diffMs / 60000);
        alerts.push({
          id:    alertId,
          short: `${table.name} · ${mins}m left`,
          full:  `${table.name} session ending in ${mins} min`,
          type:  "warning",
        });

        if (!beepedRef.current.has(alertId)) {
          beepedRef.current.add(alertId);
          beep();
        }
      } else {
        beepedRef.current.delete(alertId);
      }
    }
  }

  if (alerts.length === 0) return null;

  return (
    <div className="px-2.5 py-2 space-y-1 border-t border-gray-200 dark:border-[#1F1F1F]">
      {alerts.slice(0, 3).map((alert) => (
        <div
          key={alert.id}
          title={alert.full}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs leading-tight"
          style={{
            background: alert.type === "urgent"
              ? "rgba(239,68,68,0.07)"
              : "rgba(245,158,11,0.07)",
            border: `1px solid ${alert.type === "urgent" ? "rgba(239,68,68,0.18)" : "rgba(245,158,11,0.18)"}`,
            color: alert.type === "urgent" ? "#f87171" : "#fbbf24",
          }}
        >
          <span className="shrink-0 text-[10px]">{alert.type === "urgent" ? "⚠" : "⏱"}</span>
          <span className="truncate">{alert.short}</span>
        </div>
      ))}
      {alerts.length > 3 && (
        <p className="text-center text-[10px] text-gray-300 dark:text-[#444]">
          +{alerts.length - 3} more alerts
        </p>
      )}
    </div>
  );
}
