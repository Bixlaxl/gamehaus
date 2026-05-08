import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartItem {
  tableId: string;
  tableName: string;
  tableType: string;
  ratePerHour: number;
  scheduledStart: string; // ISO string
  scheduledEnd: string;   // ISO string
  durationMins: number;
  amount: number;
}

interface CartStore {
  locationId: string | null;
  items: CartItem[];
  setLocation: (locationId: string) => void;
  addItem: (item: CartItem) => void;
  removeItem: (tableId: string, scheduledStart: string) => void;
  clearCart: () => void;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set) => ({
      locationId: null,
      items: [],
      setLocation: (locationId) =>
        set((state) => ({
          locationId,
          items: state.locationId !== null && state.locationId !== locationId ? [] : state.items,
        })),
      addItem: (item) =>
        set((state) => ({ items: [...state.items, item] })),
      removeItem: (tableId, scheduledStart) =>
        set((state) => ({
          items: state.items.filter(
            (i) => !(i.tableId === tableId && i.scheduledStart === scheduledStart)
          ),
        })),
      clearCart: () => set({ items: [], locationId: null }),
    }),
    {
      name: "gamehaus-cart",
    }
  )
);
