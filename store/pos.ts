import { create } from "zustand";
import type { Table, Order, OrderItem, OrderExtra, Booking } from "@/lib/supabase/types";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export type TableWithStatus = Table & {
  activeOrderItem: OrderItem | null;
  upcomingBooking: (Booking & { order: Pick<Order, "customer_name" | "customer_phone" | "advance_paid"> }) | null;
};

export interface POSOrder extends Order {
  items: (OrderItem & { table: Table })[];
  extras: OrderExtra[];
}

interface POSStore {
  // Clock — single source of truth for all timers
  now: Date;

  // Data
  tables: TableWithStatus[];
  openOrders: POSOrder[];
  selectedOrderId: string | null;

  // UI state
  walkInOpen: boolean;
  walkInPrefilledTableId: string | null;
  checkinOpen: boolean;
  upcomingOpen: boolean;
  extendModalItem: OrderItem | null;
  stopConfirmItem: OrderItem | null;
  finalizeOrderId: string | null;
  pointsToRedeem: Record<string, number>; // orderId → points to redeem
  tableSessionsTableId: string | null;
  selectedTableId: string | null;

  // Location config (set once at mount)
  closingTime: string; // "HH:MM" — shop close used to cap extensions

  // Actions
  setNow: (now: Date) => void;
  setClosingTime: (closingTime: string) => void;
  setTables: (tables: TableWithStatus[]) => void;
  setOpenOrders: (orders: POSOrder[]) => void;
  selectOrder: (orderId: string | null) => void;
  setWalkInOpen: (open: boolean) => void;
  setWalkInWithTable: (tableId: string) => void;
  setCheckinOpen: (open: boolean) => void;
  setUpcomingOpen: (open: boolean) => void;
  setExtendModalItem: (item: OrderItem | null) => void;
  setStopConfirmItem: (item: OrderItem | null) => void;
  setFinalizeOrderId: (id: string | null) => void;
  setPointsToRedeem: (orderId: string, points: number) => void;
  setTableSessionsTableId: (id: string | null) => void;
  setSelectedTableId: (id: string | null) => void;

  // Optimistic patches — update store immediately, no server wait
  patchOrderItem: (itemId: string, patch: Partial<OrderItem>) => void;
  addOrderExtra: (orderId: string, extra: OrderExtra) => void;
  removeOrderExtra: (orderId: string, extraId: string) => void;
  patchOrderExtra: (orderId: string, extraId: string, patch: Partial<OrderExtra>) => void;

  // Realtime handlers
  handleOrderItemChange: (payload: RealtimePostgresChangesPayload<OrderItem>) => void;
  handleOrderChange: (payload: RealtimePostgresChangesPayload<Order>) => void;
  handleTableChange: (payload: RealtimePostgresChangesPayload<Table>) => void;
}

export const usePOSStore = create<POSStore>((set, get) => ({
  now: new Date(),
  tables: [],
  openOrders: [],
  selectedOrderId: null,
  walkInOpen: false,
  walkInPrefilledTableId: null,
  checkinOpen: false,
  upcomingOpen: false,
  extendModalItem: null,
  stopConfirmItem: null,
  finalizeOrderId: null,
  pointsToRedeem: {},
  tableSessionsTableId: null,
  selectedTableId: null,
  closingTime: "23:00",

  setNow: (now) => set({ now }),
  setClosingTime: (closingTime) => set({ closingTime }),
  setTables: (tables) => set({ tables }),
  setOpenOrders: (openOrders) => set({ openOrders }),
  selectOrder: (selectedOrderId) => set({ selectedOrderId }),
  setWalkInOpen: (walkInOpen) => set({ walkInOpen, walkInPrefilledTableId: walkInOpen ? null : null }),
  setWalkInWithTable: (tableId) => set({ walkInOpen: true, walkInPrefilledTableId: tableId }),
  setCheckinOpen: (checkinOpen) => set({ checkinOpen }),
  setUpcomingOpen: (upcomingOpen) => set({ upcomingOpen }),
  setExtendModalItem: (extendModalItem) => set({ extendModalItem }),
  setStopConfirmItem: (stopConfirmItem) => set({ stopConfirmItem }),
  setFinalizeOrderId: (finalizeOrderId) => set({ finalizeOrderId }),
  setTableSessionsTableId: (tableSessionsTableId) => set({ tableSessionsTableId }),
  setSelectedTableId: (selectedTableId) => set({ selectedTableId }),
  setPointsToRedeem: (orderId, points) =>
    set((state) => ({ pointsToRedeem: { ...state.pointsToRedeem, [orderId]: points } })),

  patchOrderItem: (itemId, patch) =>
    set((state) => ({
      openOrders: state.openOrders.map((order) => ({
        ...order,
        items: order.items.map((item) =>
          item.id === itemId ? { ...item, ...patch } : item
        ),
      })),
    })),

  addOrderExtra: (orderId, extra) =>
    set((state) => ({
      openOrders: state.openOrders.map((order) =>
        order.id === orderId
          ? { ...order, extras: [...order.extras, extra] }
          : order
      ),
    })),

  removeOrderExtra: (orderId, extraId) =>
    set((state) => ({
      openOrders: state.openOrders.map((order) =>
        order.id === orderId
          ? { ...order, extras: order.extras.filter((e) => e.id !== extraId) }
          : order
      ),
    })),

  patchOrderExtra: (orderId, extraId, patch) =>
    set((state) => ({
      openOrders: state.openOrders.map((order) =>
        order.id === orderId
          ? {
              ...order,
              extras: order.extras.map((e) => (e.id === extraId ? { ...e, ...patch } : e)),
            }
          : order
      ),
    })),

  handleOrderItemChange: (payload) => {
    const { eventType, new: newRow, old: oldRow } = payload;
    set((state) => {
      const orders = state.openOrders.map((order) => {
        let items = order.items;
        if (eventType === "INSERT") {
          const item = newRow as OrderItem & { table: Table };
          if (item.order_id === order.id) {
            items = [...items, item];
          }
        } else if (eventType === "UPDATE") {
          items = items.map((i) =>
            i.id === (newRow as OrderItem).id
              ? { ...i, ...(newRow as OrderItem) }
              : i
          );
        } else if (eventType === "DELETE") {
          items = items.filter((i) => i.id !== (oldRow as OrderItem).id);
        }
        return { ...order, items };
      });
      return { openOrders: orders };
    });
  },

  handleOrderChange: (payload) => {
    const { eventType, new: newRow } = payload;
    set((state) => {
      if (eventType === "UPDATE") {
        const updated = newRow as Order;
        // If finalized/cancelled, remove from open orders
        if (updated.status !== "open") {
          return {
            openOrders: state.openOrders.filter((o) => o.id !== updated.id),
            selectedOrderId:
              state.selectedOrderId === updated.id
                ? null
                : state.selectedOrderId,
          };
        }
        return {
          openOrders: state.openOrders.map((o) =>
            o.id === updated.id ? { ...o, ...updated } : o
          ),
        };
      }
      return {};
    });
  },

  handleTableChange: (payload) => {
    const { eventType, new: newRow } = payload;
    if (eventType === "UPDATE") {
      const updated = newRow as Table;
      set((state) => ({
        tables: state.tables.map((t) =>
          t.id === updated.id ? { ...t, ...updated } : t
        ),
      }));
    }
  },
}));

export function getSelectedOrder(store: POSStore): POSOrder | null {
  return (
    store.openOrders.find((o) => o.id === store.selectedOrderId) ?? null
  );
}
