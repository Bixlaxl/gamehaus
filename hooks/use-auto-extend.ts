import { useRef, useEffect } from "react";
import { GRACE_MINS, OT_BLOCK_MINS } from "@/lib/billing/engine";
import type { POSOrder, TableWithStatus } from "@/store/pos";

/**
 * Automatically extends running sessions in 15-min blocks after a 5-min grace period.
 * Only fires when the table has NO upcoming booking.
 * Resets per-item counters whenever expected_end changes (manual extend or prior auto-extend).
 */
export function useAutoExtend(
  now: Date,
  openOrders: POSOrder[],
  tables: TableWithStatus[],
) {
  const blocksHandled       = useRef<Record<string, number>>({});
  const lastSeenExpectedEnd = useRef<Record<string, string>>({});
  const inFlight            = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const order of openOrders) {
      for (const item of order.items) {
        if (item.status !== "running" || !item.expected_end || !item.actual_start) continue;

        const table = tables.find((t) => t.id === item.table_id);
        if (table?.upcomingBooking) continue; // next booking present — block OT, never auto-extend

        const itemId     = item.id;
        const expectedEnd = item.expected_end;

        // Reset block counter whenever expected_end changes (previous auto-extend landed in DB)
        if (lastSeenExpectedEnd.current[itemId] !== expectedEnd) {
          lastSeenExpectedEnd.current[itemId] = expectedEnd;
          blocksHandled.current[itemId]       = 0;
        }

        const otMs   = Math.max(0, now.getTime() - new Date(expectedEnd).getTime());
        const otMins = otMs / 60000;

        if (otMins <= GRACE_MINS) continue; // still in grace window

        const blocksNeeded    = Math.ceil((otMins - GRACE_MINS) / OT_BLOCK_MINS);
        const alreadyHandled  = blocksHandled.current[itemId] ?? 0;

        if (blocksNeeded > alreadyHandled && !inFlight.current.has(itemId)) {
          blocksHandled.current[itemId] = blocksNeeded;
          inFlight.current.add(itemId);

          fetch("/api/sessions/extend", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ order_item_id: itemId, extend_mins: OT_BLOCK_MINS }),
          }).finally(() => {
            inFlight.current.delete(itemId);
          });
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);
}
