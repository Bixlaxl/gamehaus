import { createClient } from "@/lib/supabase/client";
import type { usePOSStore } from "@/store/pos";

type POSStoreInstance = ReturnType<typeof usePOSStore.getState>;

export function subscribeToPOS(
  locationId: string,
  handlers: Pick<
    POSStoreInstance,
    "handleOrderItemChange" | "handleOrderChange" | "handleTableChange"
  > & {
    onInsert?: () => void;
    onExtrasChange?: () => void;
  }
) {
  const supabase = createClient();

  const channel = supabase
    .channel("pos-" + locationId)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_items" },
      (payload) => handlers.handleOrderItemChange(payload as Parameters<typeof handlers.handleOrderItemChange>[0])
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders", filter: `location_id=eq.${locationId}` },
      (payload) => {
        handlers.handleOrderChange(payload as Parameters<typeof handlers.handleOrderChange>[0]);
        if (payload.eventType === "INSERT") handlers.onInsert?.();
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "bookings" },
      () => handlers.onInsert?.()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tables", filter: `location_id=eq.${locationId}` },
      (payload) => handlers.handleTableChange(payload as Parameters<typeof handlers.handleTableChange>[0])
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_extras" },
      () => handlers.onExtrasChange?.()
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
