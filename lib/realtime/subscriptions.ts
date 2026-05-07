import { createClient } from "@/lib/supabase/client";
import type { usePOSStore } from "@/store/pos";

type POSStoreInstance = ReturnType<typeof usePOSStore.getState>;

export function subscribeToPOS(
  locationId: string,
  store: Pick<
    POSStoreInstance,
    "handleOrderItemChange" | "handleOrderChange" | "handleTableChange"
  >
) {
  const supabase = createClient();

  const channel = supabase
    .channel("pos-" + locationId)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_items" },
      (payload) => store.handleOrderItemChange(payload as Parameters<typeof store.handleOrderItemChange>[0])
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders" },
      (payload) => store.handleOrderChange(payload as Parameters<typeof store.handleOrderChange>[0])
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tables" },
      (payload) => store.handleTableChange(payload as Parameters<typeof store.handleTableChange>[0])
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
