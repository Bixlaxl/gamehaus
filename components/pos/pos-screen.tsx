"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client"; // only used for auth sign-out
import { usePOSStore } from "@/store/pos";
import { LogOut, UserPlus, QrCode, Clock } from "lucide-react";
import { subscribeToPOS } from "@/lib/realtime/subscriptions";
import { TableGrid } from "./table-grid";
import { OrderPanel } from "./order-panel";
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

  const { setWalkInOpen, setCheckinOpen, setUpcomingOpen } = usePOSStore();

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">

      {/* ── Header ──────────────────────────────────── */}
      <header className="shrink-0 flex items-center justify-between px-5 h-14 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold text-slate-100">{locationName}</span>
          <span className="text-slate-700">·</span>
          <span className="text-slate-400 text-sm">{staffName}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-300 text-sm font-mono tabular-nums">
            {now.toLocaleTimeString("en-IN", {
              hour: "2-digit", minute: "2-digit", second: "2-digit",
            })}
          </span>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-200 text-sm transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </header>

      <POSAlerts />

      {/* ── Main ────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar — tables + actions */}
        <div className="w-80 shrink-0 flex flex-col border-r border-slate-800 bg-slate-900">

          {/* Tables list — scrollable */}
          <div className="flex-1 overflow-y-auto p-3">
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest px-1 mb-2">
              Tables
            </p>
            <TableGrid />
          </div>

          {/* Action buttons — pinned to sidebar bottom */}
          <div className="shrink-0 p-3 border-t border-slate-800 space-y-2">
            <button
              onClick={() => setWalkInOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
            >
              <UserPlus className="h-4 w-4" /> New Walk-in
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setCheckinOpen(true)}
                className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-medium transition-colors"
              >
                <QrCode className="h-3.5 w-3.5" /> Check-in
              </button>
              <button
                onClick={() => setUpcomingOpen(true)}
                className="flex items-center justify-center gap-1.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-medium transition-colors"
              >
                <Clock className="h-3.5 w-3.5" /> Upcoming
              </button>
            </div>
          </div>
        </div>

        {/* Right — order detail */}
        <div className="flex-1 overflow-y-auto bg-slate-950">
          <OrderPanel locationId={locationId} />
        </div>
      </div>

      {/* Modals & sliders */}
      <WalkInSlider locationId={locationId} />
      <CheckinSlider locationId={locationId} />
      <UpcomingDrawer />
      <ExtendModal />
      <FinalizeBillModal locationId={locationId} />
    </div>
  );
}
