"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";
import { usePOSStore } from "@/store/pos";
import { LogOut, UserPlus, QrCode, Clock, Sun, Moon } from "lucide-react";
import { subscribeToPOS } from "@/lib/realtime/subscriptions";
import { useAutoExtend } from "@/hooks/use-auto-extend";
import { TableGrid } from "./table-grid";
import { OrderPanel } from "./order-panel";
import { WalkInSlider } from "./walk-in-slider";
import { CheckinSlider } from "./checkin-slider";
import { UpcomingDrawer } from "./upcoming-drawer";
import { ExtendModal } from "./extend-modal";
import { FinalizeBillModal } from "./finalize-bill-modal";
import { POSAlerts } from "./pos-alerts";
import { TableSessionsDrawer } from "./table-sessions-drawer";
import type { POSOrder, TableWithStatus } from "@/store/pos";
import type { Table, Order, OrderItem, Booking } from "@/lib/supabase/types";

interface POSScreenProps {
  locationId: string;
  locationName: string;
  staffName: string;
  userId: string;
}

const supabase = createClient();

export function POSScreen({ locationId, locationName, staffName }: POSScreenProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const qc = useQueryClient();
  const now                   = usePOSStore((s) => s.now);
  const setTables             = usePOSStore((s) => s.setTables);
  const setOpenOrders         = usePOSStore((s) => s.setOpenOrders);
  const handleOrderItemChange = usePOSStore((s) => s.handleOrderItemChange);
  const handleOrderChange     = usePOSStore((s) => s.handleOrderChange);
  const handleTableChange     = usePOSStore((s) => s.handleTableChange);

  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPopState = () => {
      window.history.pushState(null, "", window.location.href);
      if (window.confirm("Sign out and leave the POS?")) handleSignOut();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      usePOSStore.setState({ now: new Date() });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const { data: rawTables } = useQuery({
    queryKey: ["pos-tables", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/pos/tables?locationId=${locationId}`);
      const body = await res.json() as { success: boolean; data: Table[] };
      return body.success ? body.data : [];
    },
    refetchInterval: 8000,
  });

  const { data: rawOrders } = useQuery({
    queryKey: ["pos-orders", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/pos/orders?locationId=${locationId}`);
      const body = await res.json() as { success: boolean; data: POSOrder[] };
      return body.success ? body.data : [];
    },
    refetchInterval: 8000,
  });

  const { data: rawBookings } = useQuery({
    queryKey: ["pos-bookings", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/pos/bookings?locationId=${locationId}`);
      const body = await res.json() as {
        success: boolean;
        data: (Booking & {
          order: Pick<Order, "customer_name" | "customer_phone">;
          order_item: Pick<OrderItem, "table_id" | "status">;
        })[];
      };
      return body.success ? body.data : [];
    },
    refetchInterval: 8000,
  });

  useEffect(() => {
    const unsubscribe = subscribeToPOS(locationId, {
      handleOrderItemChange,
      handleOrderChange,
      handleTableChange,
      onInsert: () => {
        qc.invalidateQueries({ queryKey: ["pos-orders",   locationId] });
        qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
      },
      onExtrasChange: () => {
        qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      },
    });
    return unsubscribe;
  }, [locationId, handleOrderItemChange, handleOrderChange, handleTableChange, qc]);

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
        rawBookings?.find((b) => {
          const oi = b.order_item as Pick<OrderItem, "table_id" | "status"> | null;
          return oi?.table_id === table.id && oi?.status === "scheduled";
        }) ?? null;

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

  useEffect(() => { buildTableStatus(); }, [buildTableStatus]);
  useEffect(() => { if (rawOrders) setOpenOrders(rawOrders); }, [rawOrders, setOpenOrders]);

  const openOrders = usePOSStore((s) => s.openOrders);
  const tables     = usePOSStore((s) => s.tables);
  useAutoExtend(now, openOrders, tables);

  const { setWalkInOpen, setCheckinOpen, setUpcomingOpen } = usePOSStore();

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-black">

      {/* ── Header ── */}
      <header className="shrink-0 flex items-center justify-between px-5 h-12 bg-white dark:bg-black border-b-2 border-gray-900 dark:border-white">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-extrabold text-gray-900 dark:text-white text-sm tracking-tight">{locationName}</span>
          <span className="text-gray-300 dark:text-[#333] font-bold">·</span>
          <span className="text-xs font-bold text-gray-600 dark:text-[#aaa]">{staffName}</span>
        </div>
        <div className="flex items-center gap-5">
          <span suppressHydrationWarning className="text-sm font-bold font-mono tabular-nums text-gray-900 dark:text-white">
            {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-1 rounded-md text-gray-500 dark:text-[#888] hover:text-gray-900 dark:hover:text-white transition-colors"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-xs font-bold text-gray-600 dark:text-[#aaa] hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar */}
        <div className="w-64 shrink-0 flex flex-col border-r-2 border-gray-900 dark:border-white">
          {/* Table list */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-px">
            <p className="text-[10px] font-extrabold uppercase tracking-widest px-1 pb-2 pt-0.5 text-gray-700 dark:text-[#aaa]">
              Tables
            </p>
            <TableGrid />
          </div>

          {/* Alerts — compact chips above action buttons */}
          <POSAlerts />

          {/* Action buttons */}
          <div className="shrink-0 p-2.5 border-t-2 border-gray-900 dark:border-white">
            <button
              onClick={() => setWalkInOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-sm font-bold transition-colors hover:brightness-110 active:brightness-95"
              style={{ background: "#D4541A" }}
            >
              <UserPlus className="h-3.5 w-3.5" />
              New Walk-in
            </button>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button
                onClick={() => setCheckinOpen(true)}
                className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all
                  bg-gray-900 text-white shadow-sm hover:bg-gray-800
                  dark:bg-white dark:text-gray-900 dark:shadow-md dark:hover:bg-gray-100"
              >
                <QrCode className="h-3 w-3" /> Check-in
              </button>
              <button
                onClick={() => setUpcomingOpen(true)}
                className="flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all
                  bg-gray-900 text-white shadow-sm hover:bg-gray-800
                  dark:bg-white dark:text-gray-900 dark:shadow-md dark:hover:bg-gray-100"
              >
                <Clock className="h-3 w-3" /> Upcoming
              </button>
            </div>
          </div>
        </div>

        {/* Right — order panel handles its own column split */}
        <div className="flex-1 overflow-hidden">
          <OrderPanel locationId={locationId} />
        </div>
      </div>

      {/* Overlays */}
      <TableSessionsDrawer />
      <WalkInSlider locationId={locationId} />
      <CheckinSlider locationId={locationId} />
      <UpcomingDrawer locationId={locationId} />
      <ExtendModal />
      <FinalizeBillModal locationId={locationId} />
    </div>
  );
}
