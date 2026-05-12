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
    <div className="space-y-2">
      {tables.map((table) => {
        const item    = table.activeOrderItem;
        const booking = table.upcomingBooking;

        const isRunning = !!item && item.status === "running";
        const isBooked  = !isRunning && !!booking;
        const isIdle    = !isRunning && !isBooked;

        const order = openOrders.find((o) =>
          o.items.some((i) => i.table_id === table.id && i.status === "running")
        );

        let liveBill        = 0;
        let isOvertime      = false;
        let isFiveMinWarning = false;
        let countdown       = "";
        let elapsed         = "";

        if (isRunning && item) {
          liveBill = calculateBill([item], [], now).totalDue;

          if (item.actual_start) {
            elapsed = formatElapsed(new Date(item.actual_start), now);
          }

          if (item.expected_end) {
            const expectedEnd = new Date(item.expected_end);
            const diffMs      = expectedEnd.getTime() - now.getTime();
            isOvertime        = diffMs < 0;
            isFiveMinWarning  = diffMs > 0 && diffMs < 5 * 60 * 1000;
            countdown         = formatCountdown(expectedEnd, now);
          }
        }

        return (
          <button
            key={table.id}
            onClick={() => {
              if (isIdle) {
                setWalkInWithTable(table.id);
              } else if (order) {
                selectOrder(order.id);
              }
            }}
            className={cn(
              "w-full text-left rounded-lg p-3 border-2 transition-all",
              isRunning && !isOvertime && !isFiveMinWarning && "bg-gray-800 border-green-500",
              isRunning && isFiveMinWarning && "bg-gray-800 border-amber-400",
              isRunning && isOvertime && "overtime-border bg-gray-800",
              isBooked && "bg-gray-800 border-amber-500",
              isIdle && "bg-gray-800 border-gray-600 hover:border-gray-400",
              order?.id === selectedOrderId && "ring-2 ring-blue-400"
            )}
          >
            {/* Name row */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span>{typeIcon[table.type] ?? "🎱"}</span>
                <span className="font-semibold text-sm">{table.name}</span>
              </div>
              {isRunning && isOvertime && (
                <span className="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded font-bold animate-pulse">
                  OT
                </span>
              )}
            </div>

            {/* Running session */}
            {isRunning && item && (
              <div className="space-y-0.5 mt-1">
                {order?.customer_name && (
                  <p className="text-xs text-white font-medium truncate">
                    {order.customer_name}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 font-mono">{elapsed}</span>
                  <span
                    className={cn(
                      "text-xs font-mono",
                      isOvertime ? "text-red-400" : isFiveMinWarning ? "text-amber-400" : "text-green-400"
                    )}
                  >
                    {isOvertime ? "OVERTIME" : countdown + " left"}
                  </span>
                </div>
                <p className="text-xs text-gray-400">{formatCurrency(liveBill)}</p>
              </div>
            )}

            {/* Upcoming booking */}
            {isBooked && booking && (
              <div className="space-y-0.5 mt-1">
                <p className="text-xs text-amber-400 font-medium">
                  {new Date(booking.scheduled_start).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {booking.order?.customer_name}
                </p>
              </div>
            )}

            {/* Idle */}
            {isIdle && (
              <p className="text-xs text-gray-500 mt-1">Tap to start session</p>
            )}
          </button>
        );
      })}

      {tables.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-4">No tables configured</p>
      )}
    </div>
  );
}
