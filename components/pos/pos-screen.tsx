"use client";

import { useEffect, useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { usePOSStore } from "@/store/pos";
import { LogOut, UserPlus, QrCode } from "lucide-react";
import { subscribeToPOS } from "@/lib/realtime/subscriptions";
import { TableGrid } from "./table-grid";
import { ContextPanel } from "./context-panel";
import { POSAlerts } from "./pos-alerts";
import type { POSOrder, TableWithStatus } from "@/store/pos";
import type { Table, Order, OrderItem, Booking } from "@/lib/supabase/types";

// Overlays — lazy-loaded. Each one is a Dialog/Sheet that the staff opens
// occasionally; eagerly bundling them was adding ~70 KB to first paint of /pos.
// They each already have an outer gate that returns null when their open-state
// is unset, so the dynamic chunk only downloads when first triggered.
const OrderPanel        = dynamic(() => import("./order-panel").then(m => m.OrderPanel),               { ssr: false });
const WalkInSlider      = dynamic(() => import("./walk-in-slider").then(m => m.WalkInSlider),         { ssr: false });
const CheckinSlider     = dynamic(() => import("./checkin-slider").then(m => m.CheckinSlider),       { ssr: false });
const ExtendModal       = dynamic(() => import("./extend-modal").then(m => m.ExtendModal),           { ssr: false });
const StopConfirmModal  = dynamic(() => import("./stop-confirm-modal").then(m => m.StopConfirmModal), { ssr: false });
const FinalizeBillModal = dynamic(() => import("./finalize-bill-modal").then(m => m.FinalizeBillModal), { ssr: false });

interface POSScreenProps {
  locationId: string;
  locationName: string;
  openingTime: string;
  closingTime: string;
  staffName: string;
  userId: string;
}

const supabase = createClient();

export function POSScreen({ locationId, locationName, openingTime, closingTime, staffName }: POSScreenProps) {
  // Sync location config into the store so global modals + panels can read it
  if (usePOSStore.getState().closingTime !== closingTime) {
    usePOSStore.setState({ closingTime });
  }
  if (usePOSStore.getState().openingTime !== openingTime) {
    usePOSStore.setState({ openingTime });
  }

  const router = useRouter();

  const qc                    = useQueryClient();
  const setTables             = usePOSStore((s) => s.setTables);
  const setOpenOrders         = usePOSStore((s) => s.setOpenOrders);
  const handleOrderItemChange = usePOSStore((s) => s.handleOrderItemChange);
  const handleOrderChange     = usePOSStore((s) => s.handleOrderChange);
  const handleTableChange     = usePOSStore((s) => s.handleTableChange);
  const setWalkInOpen         = usePOSStore((s) => s.setWalkInOpen);
  const setCheckinOpen        = usePOSStore((s) => s.setCheckinOpen);
  const openOrders            = usePOSStore((s) => s.openOrders);
  const tables                = usePOSStore((s) => s.tables);
  const selectedTableId       = usePOSStore((s) => s.selectedTableId);

  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await new Promise((r) => setTimeout(r, 700));
    await supabase.auth.signOut();
    router.replace("/login");
  }

  // Back-button protection
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPopState = () => {
      window.history.pushState(null, "", window.location.href);
      if (window.confirm("Sign out and leave the POS?")) void handleSignOut();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab/window close protection — prompts browser's "Leave site?" dialog
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // 1-second clock
  useEffect(() => {
    const interval = setInterval(() => {
      usePOSStore.setState({ now: new Date() });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Data queries
  const { data: rawTables } = useQuery({
    queryKey: ["pos-tables", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/pos/tables?locationId=${locationId}`);
      const body = await res.json() as { success: boolean; data: Table[] };
      return body.success ? body.data : [];
    },
    // Realtime keeps data current; this is a safety-net poll, not the primary mechanism.
    // 60s was producing ~60 unnecessary requests/hour per staff session.
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: rawOrders } = useQuery({
    queryKey: ["pos-orders", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/pos/orders?locationId=${locationId}`);
      const body = await res.json() as { success: boolean; data: POSOrder[] };
      return body.success ? body.data : [];
    },
    // Realtime keeps data current; this is a safety-net poll, not the primary mechanism.
    // 60s was producing ~60 unnecessary requests/hour per staff session.
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: rawBookings } = useQuery({
    queryKey: ["pos-bookings", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/pos/bookings?locationId=${locationId}`);
      const body = await res.json() as {
        success: boolean;
        data: (Booking & {
          order: Pick<Order, "customer_name" | "customer_phone" | "advance_paid">;
          order_item: Pick<OrderItem, "table_id" | "status">;
        })[];
      };
      return body.success ? body.data : [];
    },
    // Realtime keeps data current; this is a safety-net poll, not the primary mechanism.
    // 60s was producing ~60 unnecessary requests/hour per staff session.
    refetchInterval: 5 * 60 * 1000,
  });

  // Realtime
  useEffect(() => {
    const unsubscribe = subscribeToPOS(locationId, {
      handleOrderItemChange,
      handleOrderChange,
      handleTableChange,
      onBookingsChange: () => {
        // No direct store handler for bookings — refetch only the bookings query.
        // Crucially we do NOT invalidate pos-orders here; that produced a
        // double render-cascade on every booking insert (handler + refetch).
        qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
      },
      onExtrasChange: () => {
        qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      },
    });
    return unsubscribe;
  }, [locationId, handleOrderItemChange, handleOrderChange, handleTableChange, qc]);

  // Build table status
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

  // NOTE: useAutoStop intentionally removed — per the agreed spec, staff
  // manually stops sessions. Overtime is shown in red on the card so it's
  // visible. Auto-stopping silently was producing surprise behaviour.

  // Right panel only opens for idle (walk-in form) or running/bill-ready (session detail).
  // Booked tables: check-in/no-show live on the card — no panel needed.
  // We use Date.now() here instead of subscribing to the per-second `now` —
  // POSScreen sits at the top of the tree and a 1s subscription would
  // re-render the entire POS every tick. The threshold (30 min) is coarse
  // enough that not having per-second precision is fine — the table's own
  // card still ticks, and any state change (tables update, selection) will
  // re-render this naturally.
  const showContextPanel = (() => {
    if (!selectedTableId) return false;
    const table = tables.find((t) => t.id === selectedTableId);
    if (!table) return false;
    const item        = table.activeOrderItem;
    const isRunning   = item?.status === "running";
    const isBillReady = !isRunning && openOrders.some((o) => {
      const live = o.items.filter((i) => !i.is_deleted);
      return live.some((i) => i.table_id === table.id && i.status === "finished") &&
             !live.some((i) => i.status === "running");
    });
    const minsUntilBooking = table.upcomingBooking
      ? (new Date(table.upcomingBooking.scheduled_start).getTime() - Date.now()) / 60000
      : Infinity;
    const isBooked = !isRunning && !isBillReady && !!table.upcomingBooking && minsUntilBooking <= 30;
    return !isBooked;
  })();

  return (
    <div className="dark h-screen flex overflow-hidden bg-[#0a0a0a]">

      {/* Sign-out overlay */}
      {signingOut && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <LogOut className="h-8 w-8 text-[#D4541A] animate-pulse mb-4" />
          <p className="text-white text-base font-semibold tracking-wide">Signing out…</p>
        </div>
      )}

      {/* ── Side rail ── */}
      <nav className="w-44 shrink-0 flex flex-col bg-[#161616] border-r border-[#222]">
        {/* Brand */}
        <div className="h-14 flex items-center gap-2.5 px-4 border-b border-[#222] shrink-0">
          <span className="font-black text-lg tracking-tight" style={{ color: "#D4541A" }}>Gamehaus</span>
        </div>

        <div className="flex-1" />

        {/* Bottom controls */}
        <div className="shrink-0 flex flex-col gap-0.5 px-2 py-3 border-t border-[#222]">
          <button
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-40"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </div>
      </nav>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <header className="shrink-0 flex items-center justify-between px-5 h-14 bg-[#111] border-b border-[#1f1f1f]">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-extrabold text-white text-sm tracking-tight">
              {locationName}
            </span>
            <span className="text-[#555] font-bold">·</span>
            <span className="text-xs font-medium text-[#888]">{staffName}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCheckinOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all border border-[#333] hover:border-[#555] hover:bg-[#1e1e1e]"
            >
              <QrCode className="h-3.5 w-3.5" />
              Check-in
            </button>
            <button
              onClick={() => setWalkInOpen(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white text-xs font-bold transition-opacity hover:opacity-90 active:opacity-75"
              style={{ background: "#D4541A" }}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Walk-in
            </button>
          </div>
        </header>

        {/* Alert strip */}
        <POSAlerts />

        {/* Split content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Table grid — always flex-1 */}
          <div className="flex-1 overflow-hidden">
            <TableGrid locationId={locationId} />
          </div>

          {/* Context panel — slides in only for idle/running/bill-ready tables */}
          <div
            className="shrink-0 border-l border-[#1f1f1f] overflow-hidden flex flex-col bg-[#111]"
            style={{
              width:      showContextPanel ? 380 : 0,
              transition: "width 0.25s ease",
            }}
          >
            <div style={{ width: 380, height: "100%" }}>
              <ContextPanel locationId={locationId} closingTime={closingTime} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Overlays ── */}
      <OrderPanel locationId={locationId} />
      <WalkInSlider locationId={locationId} />
      <CheckinSlider locationId={locationId} />
      <ExtendModal />
      <StopConfirmModal locationId={locationId} />
      <FinalizeBillModal locationId={locationId} />
    </div>
  );
}
