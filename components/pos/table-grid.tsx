"use client";

import { usePOSStore } from "@/store/pos";
import { calculateBill } from "@/lib/billing/engine";
import { formatElapsed, formatCountdown, formatCurrency, cn } from "@/lib/utils";

const typeIcon: Record<string, string> = {
  snooker:  "🎱",
  pool:     "🎱",
  ps5:      "🎮",
  foosball: "⚽",
};

export function TableGrid() {
  const { tables, now, openOrders, selectOrder, selectedOrderId, setWalkInWithTable } =
    usePOSStore();

  return (
    <div className="space-y-1.5">
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
        let isFiveMinWarning = false;
        let countdown        = "";
        let elapsed          = "";

        if (isRunning && item) {
          liveBill = calculateBill([item], [], now).totalDue;
          if (item.actual_start) elapsed = formatElapsed(new Date(item.actual_start), now);
          if (item.expected_end) {
            const expectedEnd    = new Date(item.expected_end);
            const diffMs         = expectedEnd.getTime() - now.getTime();
            isOvertime           = diffMs < 0;
            isFiveMinWarning     = diffMs > 0 && diffMs < 5 * 60 * 1000;
            countdown            = formatCountdown(expectedEnd, now);
          }
        }

        const isSelected = order?.id === selectedOrderId;

        return (
          <button
            key={table.id}
            onClick={() => {
              if (isIdle) setWalkInWithTable(table.id);
              else if (order) selectOrder(order.id);
            }}
            className={cn(
              "w-full text-left rounded-xl border-l-[3px] bg-slate-800 hover:bg-slate-750 transition-all duration-150 px-3.5 py-3",
              isRunning && !isOvertime && !isFiveMinWarning && "border-l-emerald-500",
              isRunning && isFiveMinWarning                  && "border-l-amber-400",
              isRunning && isOvertime                        && "border-l-red-500",
              isBooked                                       && "border-l-amber-500",
              isIdle                                         && "border-l-slate-700 hover:border-l-slate-500",
              isSelected && "ring-1 ring-inset ring-blue-500"
            )}
          >
            {/* Name + status pill */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm">{typeIcon[table.type] ?? "🎱"}</span>
                <span className="font-semibold text-sm text-slate-100">{table.name}</span>
              </div>

              {isRunning && (
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide",
                  isOvertime
                    ? "bg-red-500/20 text-red-400"
                    : isFiveMinWarning
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-emerald-500/20 text-emerald-400"
                )}>
                  {isOvertime ? "OT" : "Live"}
                </span>
              )}
              {isBooked && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide bg-amber-500/15 text-amber-400">
                  Booked
                </span>
              )}
              {isIdle && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide bg-slate-700 text-slate-500">
                  Idle
                </span>
              )}
            </div>

            {/* Running details */}
            {isRunning && item && (
              <div className="mt-2 space-y-1">
                {order?.customer_name && (
                  <p className="text-xs text-slate-300 font-medium truncate">{order.customer_name}</p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 font-mono tabular-nums">{elapsed}</span>
                  <span className={cn(
                    "text-xs font-mono font-semibold tabular-nums",
                    isOvertime ? "text-red-400" : isFiveMinWarning ? "text-amber-400" : "text-emerald-400"
                  )}>
                    {isOvertime ? "OVERTIME" : countdown + " left"}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-medium">{formatCurrency(liveBill)}</p>
              </div>
            )}

            {/* Booked details */}
            {isBooked && booking && (
              <div className="mt-2 space-y-0.5">
                <p className="text-xs text-slate-300 font-medium truncate">
                  {booking.order?.customer_name}
                </p>
                <p className="text-xs text-amber-400 font-medium">
                  {new Date(booking.scheduled_start).toLocaleTimeString("en-IN", {
                    hour: "2-digit", minute: "2-digit",
                  })}
                </p>
              </div>
            )}

            {/* Idle */}
            {isIdle && (
              <p className="text-xs text-slate-600 mt-1.5">Tap to start walk-in</p>
            )}
          </button>
        );
      })}

      {tables.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-slate-600 text-sm">No tables configured</p>
        </div>
      )}
    </div>
  );
}
