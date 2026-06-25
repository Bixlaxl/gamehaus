import { createClient } from "@/lib/supabase/client";
import type { usePOSStore } from "@/store/pos";

type POSStoreInstance = ReturnType<typeof usePOSStore.getState>;

export function subscribeToPOS(
  locationId: string,
  handlers: Pick<
    POSStoreInstance,
    "handleOrderItemChange" | "handleOrderChange" | "handleTableChange"
  > & {
    // Called on bookings INSERT (no direct handler exists), and on order_extras
    // changes (also no direct handler). Lets the caller invalidate just the
    // specific queries those events affect — not 'pos-orders' broadly.
    onBookingsChange?: (payload?: any) => void;
    onExtrasChange?:   (payload?: any) => void;
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
      // Direct store mutation via handleOrderChange covers INSERT/UPDATE/DELETE.
      // We DO NOT also invalidate pos-orders here — that would cause a refetch
      // that overwrites the store with identical data and triggers a second
      // render cascade for every order event.
      "postgres_changes",
      { event: "*", schema: "public", table: "orders", filter: `location_id=eq.${locationId}` },
      (payload) => handlers.handleOrderChange(payload as Parameters<typeof handlers.handleOrderChange>[0])
    )
    .on(
      // No direct handler for bookings — invalidate only the bookings query.
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "bookings" },
      () => handlers.onBookingsChange?.()
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tables", filter: `location_id=eq.${locationId}` },
      (payload) => handlers.handleTableChange(payload as Parameters<typeof handlers.handleTableChange>[0])
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_extras" },
      (payload) => handlers.onExtrasChange?.(payload as any)
    )
    .subscribe((status, err) => {
      console.log(`[Realtime POS] Subscription status for location ${locationId}:`, status);
      if (err) {
        console.error(`[Realtime POS] Subscription error for location ${locationId}:`, err);
      }
    });

  return () => { supabase.removeChannel(channel); };
}
