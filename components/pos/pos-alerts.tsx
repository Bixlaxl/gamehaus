"use client";

import { useEffect, useRef } from "react";
import { usePOSStore } from "@/store/pos";

export function POSAlerts() {
  const { tables, now, openOrders } = usePOSStore();
  const beepedRef = useRef<Set<string>>(new Set());

  const alerts: { id: string; message: string; type: "info" | "warning" | "urgent" }[] = [];

  for (const table of tables) {
    // 15 mins before next booking — call to confirm
    if (table.upcomingBooking) {
      const start = new Date(table.upcomingBooking.scheduled_start);
      const diffMs = start.getTime() - now.getTime();
      if (diffMs > 0 && diffMs < 15 * 60 * 1000) {
        alerts.push({
          id: `pre-${table.upcomingBooking.id}`,
          message: `${table.name} — ${table.upcomingBooking.order?.customer_name} arriving at ${start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}. Call to confirm.`,
          type: "info",
        });
      }

      // After held_until — mark no-show prompt
      const heldUntil = new Date(table.upcomingBooking.held_until);
      if (now > heldUntil) {
        alerts.push({
          id: `noshow-${table.upcomingBooking.id}`,
          message: `${table.upcomingBooking.order?.customer_name} (${table.name}) not arrived — Mark No-Show?`,
          type: "urgent",
        });
      }
    }

    // 5 min warning for running sessions
    if (table.activeOrderItem?.expected_end) {
      const end = new Date(table.activeOrderItem.expected_end);
      const diffMs = end.getTime() - now.getTime();
      const alertId = `5min-${table.activeOrderItem.id}`;

      if (diffMs > 0 && diffMs < 5 * 60 * 1000) {
        alerts.push({
          id: alertId,
          message: `${table.name} session ending in ${Math.ceil(diffMs / 60000)} min`,
          type: "warning",
        });

        // Beep once when entering 5-min window
        if (!beepedRef.current.has(alertId)) {
          beepedRef.current.add(alertId);
          try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
          } catch {
            // AudioContext may not be available in all contexts
          }
        }
      } else {
        beepedRef.current.delete(alertId);
      }
    }
  }

  if (alerts.length === 0) return null;

  return (
    <div className="shrink-0 px-3 py-1.5 space-y-1 bg-gray-800 border-b border-gray-700">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm ${
            alert.type === "urgent"
              ? "bg-red-900/50 text-red-300 border border-red-700"
              : alert.type === "warning"
              ? "bg-amber-900/50 text-amber-300 border border-amber-700"
              : "bg-blue-900/50 text-blue-300 border border-blue-700"
          }`}
        >
          <span>{alert.message}</span>
        </div>
      ))}
    </div>
  );
}
