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
  customer_points?: number;
}

interface POSStore {
  // Clock — single source of truth for all timers
  now: Date;

  // Data
  tables: TableWithStatus[];
  openOrders: POSOrder[];
  bookings: any[];
  selectedOrderId: string | null;

  // UI state
  walkInOpen: boolean;
  walkInPrefilledTableId: string | null;
  checkinOpen: boolean;
  upcomingDrawerOpen: boolean;
  extendModalItem: OrderItem | null;
  stopConfirmItem: OrderItem | null;
  finalizeOrderId: string | null;
  pointsToRedeem: Record<string, number>; // orderId → points to redeem
  selectedTableId: string | null;

  // Location config (set once at mount)
  openingTime: string; // "HH:MM" — shop open used to gate walk-in start
  closingTime: string; // "HH:MM" — shop close used to cap extensions + walk-ins

  // Actions
  setNow: (now: Date) => void;
  setOpeningTime: (openingTime: string) => void;
  setClosingTime: (closingTime: string) => void;
  setTables: (tables: Table[]) => void;
  setOpenOrders: (orders: POSOrder[]) => void;
  setBookings: (bookings: any[]) => void;
  selectOrder: (orderId: string | null) => void;
  setWalkInOpen: (open: boolean) => void;
  setWalkInWithTable: (tableId: string) => void;
  setCheckinOpen: (open: boolean) => void;
  setUpcomingDrawerOpen: (open: boolean) => void;
  setExtendModalItem: (item: OrderItem | null) => void;
  setStopConfirmItem: (item: OrderItem | null) => void;
  setFinalizeOrderId: (id: string | null) => void;
  setPointsToRedeem: (orderId: string, points: number) => void;
  setSelectedTableId: (id: string | null) => void;

  // Optimistic patches — update store immediately, no server wait
  patchOrderItem: (itemId: string, patch: Partial<OrderItem>) => void;
  addOrderExtra: (orderId: string, extra: OrderExtra) => void;
  removeOrderExtra: (orderId: string, extraId: string) => void;
  patchOrderExtra: (orderId: string, extraId: string, patch: Partial<OrderExtra>) => void;
  // Swap the client-generated tempId of an optimistically-added extra with the
  // real DB id once the POST returns. Prevents subsequent PATCH/DELETE calls
  // from 404ing because the server doesn't know the tempId.
  replaceOrderExtraId: (orderId: string, tempId: string, realId: string) => void;

  // Realtime handlers
  handleOrderItemChange: (payload: RealtimePostgresChangesPayload<OrderItem>) => void;
  handleOrderChange: (payload: RealtimePostgresChangesPayload<Order>) => void;
  handleTableChange: (payload: RealtimePostgresChangesPayload<Table>) => void;
}

function computeTablesWithStatus(
  rawTables: Table[],
  openOrders: POSOrder[],
  bookings: any[]
): TableWithStatus[] {
  const activeItems = openOrders.flatMap((o) =>
    (o.items ?? []).filter(
      (i) => (i.status === "running" || i.status === "scheduled" || i.status === "finished") && !i.is_deleted
    )
  );
  return rawTables.map((table) => {
    const runningItem = activeItems.find((i) => i.table_id === table.id && i.status === "running");
    let activeItem = runningItem ?? null;

    if (!activeItem) {
      const finishedItem = activeItems.find((i) => i.table_id === table.id && i.status === "finished");
      if (finishedItem) {
        // If this customer's order has another session that is still running,
        // we free up this table card so the next customer can check in.
        // The staff can still view/collect the finished session's bill
        // from the other active table's card.
        const hasOtherRunning = activeItems.some(
          (i) => i.order_id === finishedItem.order_id && i.status === "running"
        );
        if (!hasOtherRunning) {
          activeItem = finishedItem;
        }
      }
    }
    const upcomingBooking =
      bookings?.find((b) => {
        const oi = b.order_item as any;
        const nowMs = Date.now();
        const endMs = new Date(b.scheduled_end).getTime();
        return oi?.table_id === table.id && oi?.status === "scheduled" && endMs > nowMs;
      }) ?? null;
    return {
      ...table,
      activeOrderItem: activeItem,
      upcomingBooking: upcomingBooking
        ? { ...upcomingBooking, order: upcomingBooking.order as any }
        : null,
    };
  });
}

export const usePOSStore = create<POSStore>((set, get) => ({
  now: new Date(),
  tables: [],
  openOrders: [],
  bookings: [],
  selectedOrderId: null,
  walkInOpen: false,
  walkInPrefilledTableId: null,
  checkinOpen: false,
  upcomingDrawerOpen: false,
  extendModalItem: null,
  stopConfirmItem: null,
  finalizeOrderId: null,
  pointsToRedeem: {},
  selectedTableId: null,
  openingTime: "10:00",
  closingTime: "23:00",

  setNow: (now) => set({ now }),
  setOpeningTime: (openingTime) => set({ openingTime }),
  setClosingTime: (closingTime) => set({ closingTime }),

  setTables: (rawTables) => set((state) => ({
    tables: computeTablesWithStatus(rawTables, state.openOrders, state.bookings)
  })),

  setOpenOrders: (openOrders) => set((state) => ({
    openOrders,
    tables: computeTablesWithStatus(state.tables, openOrders, state.bookings)
  })),

  setBookings: (bookings) => set((state) => ({
    bookings,
    tables: computeTablesWithStatus(state.tables, state.openOrders, bookings)
  })),

  selectOrder: (selectedOrderId) => set({ selectedOrderId }),
  setWalkInOpen: (walkInOpen) => set({ walkInOpen, walkInPrefilledTableId: walkInOpen ? null : null }),
  setWalkInWithTable: (tableId) => set({ walkInOpen: true, walkInPrefilledTableId: tableId }),
  setCheckinOpen: (checkinOpen) => set({ checkinOpen }),
  setUpcomingDrawerOpen: (upcomingDrawerOpen) => set({ upcomingDrawerOpen }),
  setExtendModalItem: (extendModalItem) => set({ extendModalItem }),
  setStopConfirmItem: (stopConfirmItem) => set({ stopConfirmItem }),
  setFinalizeOrderId: (finalizeOrderId) => set({ finalizeOrderId }),
  setSelectedTableId: (selectedTableId) => set({ selectedTableId }),
  setPointsToRedeem: (orderId, points) =>
    set((state) => ({ pointsToRedeem: { ...state.pointsToRedeem, [orderId]: points } })),

  patchOrderItem: (itemId, patch) =>
    set((state) => {
      const openOrders = state.openOrders.map((order) => ({
        ...order,
        items: order.items.map((item) =>
          item.id === itemId ? { ...item, ...patch } : item
        ),
      }));
      const tables = computeTablesWithStatus(state.tables, openOrders, state.bookings);
      return { openOrders, tables };
    }),

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

  replaceOrderExtraId: (orderId, tempId, realId) =>
    set((state) => ({
      openOrders: state.openOrders.map((order) =>
        order.id === orderId
          ? {
              ...order,
              extras: order.extras.map((e) => (e.id === tempId ? { ...e, id: realId } : e)),
            }
          : order
      ),
    })),

  handleOrderItemChange: (payload) => {
    const { eventType, new: newRow, old: oldRow } = payload;
    set((state) => {
      const orderId = eventType === "DELETE" ? (oldRow as any)?.order_id : (newRow as any)?.order_id;
      if (!orderId) return {};
      const hasOrder = state.openOrders.some((o) => o.id === orderId);
      if (!hasOrder) return {};

      const orders = state.openOrders.map((order) => {
        let items = order.items;
        if (eventType === "INSERT") {
          const rawItem = newRow as OrderItem;
          const table = state.tables.find((t) => t.id === rawItem.table_id);
          const item = { ...rawItem, table } as OrderItem & { table: Table };
          if (item.order_id === order.id) {
            items = [...items, item];
          }
        } else if (eventType === "UPDATE") {
          const rawItem = newRow as OrderItem;
          const table = state.tables.find((t) => t.id === rawItem.table_id);
          items = items.map((i) =>
            i.id === rawItem.id
               ? { ...i, ...rawItem, table: table || i.table }
               : i
          );
        } else if (eventType === "DELETE") {
          items = items.filter((i) => i.id !== (oldRow as OrderItem).id);
        }
        return { ...order, items };
      });

      const tables = computeTablesWithStatus(state.tables, orders, state.bookings);
      return { openOrders: orders, tables };
    });
  },

  handleOrderChange: (payload) => {
    const { eventType, new: newRow, old: oldRow } = payload;
    set((state) => {
      let orders = state.openOrders;
      let selectedOrderId = state.selectedOrderId;
      if (eventType === "INSERT") {
        const inserted = newRow as Order;
        if (inserted.status === "open") {
          const exists = state.openOrders.some((o) => o.id === inserted.id);
          if (!exists) {
            const newOrder: POSOrder = {
              ...inserted,
              items: [],
              extras: [],
            };
            orders = [...orders, newOrder];
          }
        }
      } else if (eventType === "UPDATE") {
        const updated = newRow as Order;
        if (updated.status !== "open") {
          orders = state.openOrders.filter((o) => o.id !== updated.id);
          selectedOrderId = state.selectedOrderId === updated.id ? null : state.selectedOrderId;
        } else {
          orders = state.openOrders.map((o) =>
            o.id === updated.id ? { ...o, ...updated } : o
          );
        }
      } else if (eventType === "DELETE") {
        const deletedId = (oldRow as any)?.id;
        if (deletedId) {
          orders = state.openOrders.filter((o) => o.id !== deletedId);
          selectedOrderId = state.selectedOrderId === deletedId ? null : state.selectedOrderId;
        }
      }
      const tables = computeTablesWithStatus(state.tables, orders, state.bookings);
      return { openOrders: orders, tables, selectedOrderId };
    });
  },

  handleTableChange: (payload) => {
    const { eventType, new: newRow } = payload;
    if (eventType === "UPDATE") {
      const updated = newRow as Table;
      set((state) => {
        const rawTables = state.tables.map((t) =>
          t.id === updated.id ? { ...t, ...updated } : t
        );
        const tables = computeTablesWithStatus(rawTables, state.openOrders, state.bookings);
        return { tables };
      });
    }
  },
}));

export function getSelectedOrder(store: POSStore): POSOrder | null {
  return (
    store.openOrders.find((o) => o.id === store.selectedOrderId) ?? null
  );
}
