"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client"; // only used for auth sign-out
import { usePOSStore } from "@/store/pos";
import { LogOut } from "lucide-react";
import { subscribeToPOS } from "@/lib/realtime/subscriptions";
import { TableGrid } from "./table-grid";
import { OrderPanel } from "./order-panel";
import { BottomBar } from "./bottom-bar";
import { WalkInSlider } from "./walk-in-slider";
import { CheckinSlider } from "./checkin-slider";
import { UpcomingDrawer } from "./upcoming-drawer";
import { ExtendModal } from "./extend-modal";
import { FinalizeBillModal } from "./finalize-bill-modal";
import { POSAlerts } from "./pos-alerts";
import type { POSOrder, TableWithStatus } from "@/store/pos";
import type { Table, Order, OrderItem, Booking } from "@/lib/supabase/types";

interface POSScreenProps {
  locationId: string;
  locationName: string;
  staffName: string;
  userId: string;
}

const supabase = createClient();

export function POSScreen({
  locationId,
  locationName,
  staffName,
}: POSScreenProps) {
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const qc = useQueryClient();

  // Use stable selectors — these function references never change
  const now = usePOSStore((s) => s.now);
  const setTables = usePOSStore((s) => s.setTables);
  const setOpenOrders = usePOSStore((s) => s.setOpenOrders);
  const handleOrderItemChange = usePOSStore((s) => s.handleOrderItemChange);
  const handleOrderChange = usePOSStore((s) => s.handleOrderChange);
  const handleTableChange = usePOSStore((s) => s.handleTableChange);

  // Prevent accidental back-button navigation — prompt to sign out instead
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPopState = () => {
      window.history.pushState(null, "", window.location.href);
      if (window.confirm("Sign out and leave the POS?")) {
        handleSignOut();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single 1-second interval for all timers
  useEffect(() => {
    const interval = setInterval(() => {
      usePOSStore.setState({ now: new Date() });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Load tables via admin-client API (bypasses RLS)
  const { data: rawTables } = useQuery({
    queryKey: ["pos-tables", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/pos/tables?locationId=${locationId}`);
      const body = await res.json() as { success: boolean; data: Table[] };
      return body.success ? body.data : [];
    },
    refetchInterval: 8000,
  });

  // Load open orders via admin-client API (bypasses RLS)
  const { data: rawOrders } = useQuery({
    queryKey: ["pos-orders", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/pos/orders?locationId=${locationId}`);
      const body = await res.json() as { success: boolean; data: POSOrder[] };
      return body.success ? body.data : [];
    },
    refetchInterval: 8000,
  });

  // Load today's bookings via admin-client API (bypasses RLS)
  const { data: rawBookings } = useQuery({
    queryKey: ["pos-bookings", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/pos/bookings?locationId=${locationId}`);
      const body = await res.json() as {
        success: boolean;
        data: (Booking & {
          order: Pick<Order, "customer_name" | "customer_phone">;
          order_item: Pick<OrderItem, "table_id">;
        })[];
      };
      return body.success ? body.data : [];
    },
    refetchInterval: 8000,
  });

  // Supabase Realtime subscription — onInsert forces immediate refetch
  useEffect(() => {
    const unsubscribe = subscribeToPOS(locationId, {
      handleOrderItemChange,
      handleOrderChange,
      handleTableChange,
      onInsert: () => {
        qc.invalidateQueries({ queryKey: ["pos-orders",   locationId] });
        qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
      },
    });
    return unsubscribe;
  }, [locationId, handleOrderItemChange, handleOrderChange, handleTableChange, qc]);

  // Merge tables with live status — stable deps, no store object
  const buildTableStatus = useCallback(() => {
    if (!rawTables) return;

    const activeItems = (rawOrders ?? []).flatMap((o) =>
      (o.items ?? []).filter(
        (i) => (i.status === "running" || i.status === "scheduled") && !i.is_deleted
      )
    );

    const tablesWithStatus: TableWithStatus[] = rawTables.map((table) => {
      const activeItem =
        activeItems.find((i) => i.table_id === table.id && i.status === "running") ?? null;

      const upcomingBooking =
        rawBookings?.find(
          (b) => (b.order_item as Pick<OrderItem, "table_id">).table_id === table.id
        ) ?? null;

      return {
        ...table,
        activeOrderItem: activeItem as OrderItem | null,
        upcomingBooking: upcomingBooking
          ? { ...upcomingBooking, order: upcomingBooking.order }
          : null,
      };
    });

    setTables(tablesWithStatus);
  }, [rawTables, rawOrders, rawBookings, setTables]);

  useEffect(() => {
    buildTableStatus();
  }, [buildTableStatus]);

  useEffect(() => {
    if (rawOrders) setOpenOrders(rawOrders);
  }, [rawOrders, setOpenOrders]);

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white">{locationName}</span>
          <span className="text-gray-400 text-sm">·</span>
          <span className="text-gray-300 text-sm">{staffName}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-gray-300 text-sm font-mono">
            {now.toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </header>

      {/* Alerts bar */}
      <POSAlerts />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-72 shrink-0 border-r border-gray-700 overflow-y-auto p-3 bg-gray-900">
          <TableGrid />
        </div>
        <div className="flex-1 overflow-y-auto">
          <OrderPanel locationId={locationId} />
        </div>
      </div>

      {/* Bottom action bar */}
      <BottomBar locationId={locationId} />

      {/* Modals & sliders */}
      <WalkInSlider locationId={locationId} />
      <CheckinSlider locationId={locationId} />
      <UpcomingDrawer />
      <ExtendModal />
      <FinalizeBillModal locationId={locationId} />
    </div>
  );
}
