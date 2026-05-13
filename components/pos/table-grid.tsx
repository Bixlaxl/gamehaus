"use client";

import { usePOSStore } from "@/store/pos";
import { calculateBill, GRACE_MINS } from "@/lib/billing/engine";
import { formatElapsed, formatCountdown, formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

const typeIcon: Record<string, string> = {
  snooker:  "🎱",
  pool:     "🎱",
  ps5:      "🎮",
  foosball: "⚽",
};

export function TableGrid() {
  const { tables, now, openOrders, selectedOrderId, setWalkInWithTable, setTableSessionsTableId } =
    usePOSStore();

  return (
    <div className="space-y-1">
      {tables.map((table) => {
        const item    = table.activeOrderItem;
        const booking = table.upcomingBooking;

        const isRunning = !!item && item.status === "running";
        const isBooked  = !isRunning && !!booking;
        const isIdle    = !isRunning && !isBooked;

        const order = openOrders.find((o) =>
          o.items.some((i) => i.table_id === table.id && i.status === "running")
        );

        let liveBill         = 0;
        let isOvertime       = false;
        let isGrace          = false;
        let isFiveMinWarning = false;
        let countdown        = "";
        let elapsed          = "";

        if (isRunning && item) {
          liveBill = calculateBill([item], [], now).subtotal;
          if (item.actual_start) elapsed = formatElapsed(new Date(item.actual_start), now);
          if (item.expected_end) {
            const exp    = new Date(item.expected_end);
            const diffMs = exp.getTime() - now.getTime();
            const otMs   = -diffMs; // positive when past expected_end

            isFiveMinWarning = diffMs > 0 && diffMs < 5 * 60 * 1000;
            isGrace          = otMs > 0 && otMs <= GRACE_MINS * 60 * 1000 && !booking;
            isOvertime       = diffMs < 0 && !isGrace;
            countdown        = isGrace
              ? formatCountdown(new Date(exp.getTime() + GRACE_MINS * 60 * 1000), now)
              : formatCountdown(exp, now);
          }
        }

        const isSelected    = order?.id === selectedOrderId;
        const hasNextBooking = !!booking;
        const showHandover  = isRunning && isOvertime && hasNextBooking;

        // Status badge
        const badge = isRunning
          ? { label: showHandover ? "Handover" : isOvertime ? "OT" : isGrace ? "Grace" : "Live",
              color: showHandover ? "#f97316" : isOvertime ? "#ef4444" : (isGrace || isFiveMinWarning) ? "#f59e0b" : "#10b981",
              bg:    showHandover ? "rgba(249,115,22,0.1)" : isOvertime ? "rgba(239,68,68,0.1)" : (isGrace || isFiveMinWarning) ? "rgba(245,158,11,0.1)" : "rgba(16,185,129,0.1)" }
          : isBooked
          ? { label: "Booked", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" }
          : null;

        return (
          <button
            key={table.id}
            onClick={() => isIdle ? setWalkInWithTable(table.id) : setTableSessionsTableId(table.id)}
            className={cn(
              "w-full text-left rounded-lg transition-all duration-100 active:scale-[0.98]",
              isSelected
                ? "bg-orange-50 hover:bg-orange-100 dark:bg-[rgba(212,84,26,0.06)] dark:hover:bg-[rgba(212,84,26,0.1)] border border-orange-200 dark:border-[rgba(212,84,26,0.25)]"
                : isRunning
                ? showHandover
                  ? "bg-white hover:bg-orange-50 dark:bg-[#111] dark:hover:bg-[rgba(249,115,22,0.05)] border-2 border-orange-300 dark:border-[rgba(249,115,22,0.35)]"
                  : isOvertime
                  ? "bg-white hover:bg-red-50 dark:bg-[#111] dark:hover:bg-[rgba(239,68,68,0.05)] border-2 border-red-300 dark:border-[rgba(239,68,68,0.35)]"
                  : (isGrace || isFiveMinWarning)
                  ? "bg-white hover:bg-amber-50 dark:bg-[#111] dark:hover:bg-[rgba(245,158,11,0.05)] border-2 border-amber-300 dark:border-[rgba(245,158,11,0.35)]"
                  : "bg-white hover:bg-emerald-50 dark:bg-[#111] dark:hover:bg-[rgba(16,185,129,0.05)] border-2 border-emerald-300 dark:border-[rgba(16,185,129,0.35)]"
                : isBooked
                ? "bg-white hover:bg-amber-50 dark:bg-[#111] dark:hover:bg-[rgba(245,158,11,0.04)] border-2 border-amber-200 dark:border-[rgba(245,158,11,0.25)]"
                : "bg-white hover:bg-gray-50 dark:bg-[#111] dark:hover:bg-[#161616] border border-gray-200 dark:border-[#1F1F1F]"
            )}
            style={{ padding: isIdle ? "8px 10px" : "10px 10px" }}
          >
            {/* Row 1: icon + name + badge */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm shrink-0">{typeIcon[table.type] ?? "🎱"}</span>
                <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">{table.name}</span>
              </div>
              {badge ? (
                <span
                  className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                  style={{ background: badge.bg, color: badge.color }}
                >
                  {badge.label}
                </span>
              ) : (
                <span className="text-[9px] font-semibold shrink-0 text-gray-300 dark:text-[#3A3A3A]">
                  Idle
                </span>
              )}
            </div>

            {/* Running details */}
            {isRunning && item && (
              <div className="mt-2 space-y-1">
                {order?.customer_name && (
                  <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{order.customer_name}</p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono tabular-nums text-gray-400 dark:text-[#555]">
                    {elapsed}
                  </span>
                  <span
                    className="text-[11px] font-mono font-semibold tabular-nums"
                    style={{ color: showHandover ? "#f97316" : isOvertime ? "#ef4444" : (isGrace || isFiveMinWarning) ? "#f59e0b" : "#10b981" }}
                  >
                    {showHandover ? "handover" : isOvertime ? `+${countdown} OT` : isGrace ? `${countdown} grace` : countdown + " left"}
                  </span>
                </div>
                <p className="text-sm font-bold tabular-nums" style={{ color: "#D4541A" }}>{formatCurrency(liveBill)}</p>
              </div>
            )}

            {/* Booked details */}
            {isBooked && booking && (
              <div className="mt-1.5 space-y-0.5">
                <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{booking.order?.customer_name}</p>
                <p className="text-[11px] font-mono" style={{ color: "#f59e0b" }}>
                  {new Date(booking.scheduled_start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            )}

            {/* Idle hint */}
            {isIdle && (
              <p className="text-[10px] mt-0.5 text-gray-300 dark:text-[#333]">Tap to start</p>
            )}
          </button>
        );
      })}

      {tables.length === 0 && (
        <p className="py-8 text-center text-xs text-gray-400 dark:text-[#444]">No tables configured</p>
      )}
    </div>
  );
}
