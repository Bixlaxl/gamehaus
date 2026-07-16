"use client";

import { useRef, useState, useEffect } from "react";
import { usePOSStore } from "@/store/pos";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X } from "lucide-react";

interface POSAlertsProps {
  locationId: string;
}

export function POSAlerts({ locationId }: POSAlertsProps) {
  const qc = useQueryClient();
  const tables = usePOSStore((s) => s.tables);
  const now    = usePOSStore((s) => s.now);
  const openOrders = usePOSStore((s) => s.openOrders);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

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

  // 1. Gather pending customer tablet orders
  const pendingExtrasList = openOrders.flatMap((order) => {
    const tableNames = order.items.map((i) => i.table?.name).filter(Boolean).join(", ");
    const displayTable = tableNames ? `Table ${tableNames}` : "A table";
    return (order.extras ?? [])
      .filter((e) => !e.is_deleted && e.name.startsWith("[PENDING]"))
      .map((e) => ({
        id: e.id,
        orderId: order.id,
        cleanName: e.name.replace("[PENDING] ", ""),
        quantity: e.quantity,
        tableLabel: displayTable,
        customerName: order.customer_name || "Walk-in Customer",
      }));
  });

  // Beep when a new pending tablet order arrives
  useEffect(() => {
    pendingExtrasList.forEach((extra) => {
      const beepId = `pending-${extra.id}`;
      if (!beepedRef.current.has(beepId)) {
        beepedRef.current.add(beepId);
        beep();
      }
    });
  }, [pendingExtrasList]);

  // Action handlers
  async function handleAccept(orderId: string, extraId: string, cleanName: string) {
    setActionLoading(extraId);
    try {
      const res = await fetch(`/api/orders/${orderId}/extras/${extraId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleanName }),
      });
      if (!res.ok) throw new Error("Failed to accept tablet order");
      toast.success(`Accepted: ${cleanName}`);
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    } catch (e: any) {
      toast.error(e.message || "Error accepting order");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDecline(orderId: string, extraId: string, cleanName: string) {
    setActionLoading(extraId);
    try {
      const res = await fetch(`/api/orders/${orderId}/extras/${extraId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to decline tablet order");
      toast.success(`Declined & removed: ${cleanName}`);
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      qc.invalidateQueries({ queryKey: ["inventory", locationId] });
    } catch (e: any) {
      toast.error(e.message || "Error declining order");
    } finally {
      setActionLoading(null);
    }
  }

  // 2. Regular session/booking alerts
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
      }
    }
  }

  if (pendingExtrasList.length === 0 && alerts.length === 0) return null;

  return (
    <>
      {/* ── Floating pending tablet orders (Top-Right, Big, Tick/Cross) ── */}
      {pendingExtrasList.length > 0 && (
        <div className="fixed top-6 right-6 z-[9999] flex flex-col gap-4 w-[26rem] max-w-md pointer-events-none">
          {pendingExtrasList.map((extra) => {
            const isBusy = actionLoading === extra.id;
            return (
              <div
                key={extra.id}
                className="pointer-events-auto flex items-center justify-between gap-5 p-6 rounded-[24px] border-2 border-orange-500 bg-white dark:bg-[#1a1a1a] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)] animate-in fade-in slide-in-from-top-5 duration-300"
              >
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  <span className="text-4xl shrink-0 mt-0.5" role="img" aria-label="bell">🔔</span>
                  <div className="space-y-1 min-w-0">
                    <p className="text-xs uppercase font-extrabold tracking-widest text-orange-600 dark:text-orange-400">
                      Kiosk Order
                    </p>
                    <p className="text-2xl font-black text-gray-900 dark:text-white leading-tight truncate">
                      {extra.quantity}x {extra.cleanName}
                    </p>
                    <p className="text-base font-extrabold text-gray-500 dark:text-gray-400">
                      {extra.tableLabel} <span className="text-xs font-normal opacity-85">({extra.customerName})</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <button
                     disabled={isBusy}
                     onClick={() => handleAccept(extra.orderId, extra.id, extra.cleanName)}
                     className="flex items-center justify-center w-14 h-14 text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 rounded-2xl shadow-lg transition-transform hover:scale-105 active:scale-95"
                     title="Accept Order"
                  >
                    <Check className="h-8 w-8 stroke-[3.5px]" />
                  </button>
                  <button
                     disabled={isBusy}
                     onClick={() => handleDecline(extra.orderId, extra.id, extra.cleanName)}
                     className="flex items-center justify-center w-14 h-14 text-white bg-red-650 hover:bg-red-500 active:bg-red-750 disabled:opacity-50 rounded-2xl shadow-lg transition-transform hover:scale-105 active:scale-95"
                     title="Decline Order"
                  >
                    <X className="h-8 w-8 stroke-[3.5px]" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Standard inline Time alerts ── */}
      {alerts.length > 0 && (
        <div className="px-6 py-4 space-y-4 border-t border-gray-200 dark:border-[#1F1F1F] bg-gray-50/50 dark:bg-[#0d0d0d]/30">
          {alerts.slice(0, 3).map((alert) => (
            <div
              key={alert.id}
              title={alert.full}
              className="flex items-center gap-3 px-5 py-4 rounded-xl text-lg font-black leading-tight border-2"
              style={{
                background: alert.type === "urgent"
                  ? "rgba(239,68,68,0.08)"
                  : "rgba(245,158,11,0.08)",
                borderColor: alert.type === "urgent" ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.3)",
                color: alert.type === "urgent" ? "#ef4444" : "#f59e0b",
              }}
            >
              <span className="shrink-0 text-xl">{alert.type === "urgent" ? "⚠" : "⏱"}</span>
              <span className="truncate">{alert.short}</span>
            </div>
          ))}

          {alerts.length > 3 && (
            <p className="text-center text-sm font-black text-gray-400 dark:text-[#666]">
              +{alerts.length - 3} more alerts
            </p>
          )}
        </div>
      )}
    </>
  );
}
