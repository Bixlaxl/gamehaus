import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartExtra {
  inventoryItemId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface CartItem {
  tableId: string;
  tableName: string;
  tableType: string;
  /** For dynamic multi-mode tables */
  selectedModeId?: string;
  selectedModeName?: string;
  ratePerHour: number;
  numPeople?: number; // for tiered pricing (controllers or players); null = flat rate
  scheduledStart: string; // ISO string
  scheduledEnd: string;   // ISO string
  durationMins: number;
  amount: number;
  selectedExtras?: CartExtra[];
}

interface CartStore {
  locationId: string | null;
  items: CartItem[];
  setLocation: (locationId: string) => void;
  addItem: (item: CartItem) => void;
  removeItem: (tableId: string, scheduledStart: string) => void;
  updateItemExtras: (tableId: string, scheduledStart: string, extras: CartExtra[]) => void;
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
      updateItemExtras: (tableId, scheduledStart, extras) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.tableId === tableId && i.scheduledStart === scheduledStart
              ? { ...i, selectedExtras: extras }
              : i
          ),
        })),
      clearCart: () => set({ items: [], locationId: null }),
    }),
    {
      name: "gamehaus-cart",
    }
  )
);
