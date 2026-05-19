import { useRef, useEffect } from "react";
import type { POSOrder } from "@/store/pos";

// Grace period before auto-stop fires after expected_end
const AUTO_STOP_GRACE_MINS = 2;

/**
 * Automatically stops running sessions 2 minutes after their expected_end.
 * No overtime is ever charged — bill is whatever it was at expected_end.
 * Resets per-item tracking when expected_end changes (staff extended manually).
 */
export function useAutoStop(now: Date, openOrders: POSOrder[]) {
  const inFlight            = useRef<Set<string>>(new Set());
  const lastSeenExpectedEnd = useRef<Record<string, string>>({});

  useEffect(() => {
    for (const order of openOrders) {
      for (const item of order.items) {
        if (item.status !== "running" || !item.expected_end) continue;

        const itemId      = item.id;
        const expectedEnd = item.expected_end;

        // Reset tracking when expected_end changes (staff extended)
        if (lastSeenExpectedEnd.current[itemId] !== expectedEnd) {
          lastSeenExpectedEnd.current[itemId] = expectedEnd;
          inFlight.current.delete(itemId);
        }

        if (inFlight.current.has(itemId)) continue;

        const otMins = (now.getTime() - new Date(expectedEnd).getTime()) / 60000;

        if (otMins > AUTO_STOP_GRACE_MINS) {
          inFlight.current.add(itemId);
          fetch("/api/sessions/stop", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ order_item_id: itemId }),
          }).catch(() => {
            inFlight.current.delete(itemId);
          });
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);
}
