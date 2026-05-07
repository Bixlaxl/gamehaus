"use client";

import { usePOSStore } from "@/store/pos";
import { calculateBill } from "@/lib/billing/engine";
import { formatCountdown, formatCurrency, cn } from "@/lib/utils";

export function TableGrid() {
  const { tables, now, openOrders, selectOrder, selectedOrderId } =
    usePOSStore();

  return (
    <div className="space-y-2">
      {tables.map((table) => {
        const item = table.activeOrderItem;
        const booking = table.upcomingBooking;

        const isRunning = !!item && item.status === "running";
        const isBooked = !isRunning && !!booking;
        const isIdle = !isRunning && !isBooked;

        // Find which order this table belongs to
        const order = openOrders.find((o) =>
          o.items.some((i) => i.table_id === table.id && i.status === "running")
        );

        // Live billing preview for running sessions
        let liveBill = 0;
        let isOvertime = false;
        let isFiveMinWarning = false;
        let countdown = "";

        if (isRunning && item) {
          const bill = calculateBill(
            [item],
            [],
            now
          );
          liveBill = bill.totalDue;

          if (item.expected_end) {
            const expectedEnd = new Date(item.expected_end);
            const diffMs = expectedEnd.getTime() - now.getTime();
            isOvertime = diffMs < 0;
            isFiveMinWarning = diffMs > 0 && diffMs < 5 * 60 * 1000;
            countdown = formatCountdown(expectedEnd, now);
          }
        }

        const typeIcon: Record<string, string> = {
          snooker: "🎱",
          pool: "🎱",
          ps5: "🎮",
        };

        return (
          <button
            key={table.id}
            onClick={() => {
              if (order) selectOrder(order.id);
            }}
            className={cn(
              "w-full text-left rounded-lg p-3 border-2 transition-all",
              isRunning && !isOvertime && !isFiveMinWarning &&
                "bg-gray-800 border-green-500",
              isRunning && isFiveMinWarning &&
                "bg-gray-800 border-amber-400",
              isRunning && isOvertime &&
                "overtime-border bg-gray-800",
              isBooked && "bg-gray-800 border-amber-500",
              isIdle && "bg-gray-800 border-gray-600 hover:border-gray-400",
              order?.id === selectedOrderId && "ring-2 ring-blue-400"
            )}
          >
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

            {isRunning && item && (
              <div className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-xs font-mono",
                      isOvertime ? "text-red-400" : isFiveMinWarning ? "text-amber-400" : "text-green-400"
                    )}
                  >
                    {isOvertime ? "OVERTIME" : countdown}
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  {formatCurrency(liveBill)} so far
                </p>
              </div>
            )}

            {isBooked && booking && (
              <div className="space-y-0.5">
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

            {isIdle && (
              <p className="text-xs text-gray-500 mt-1">Idle</p>
            )}
          </button>
        );
      })}

      {tables.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-4">
          No tables configured
        </p>
      )}
    </div>
  );
}
