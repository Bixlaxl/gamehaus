"use client";

import { useEffect, useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { usePOSStore } from "@/store/pos";
import { LogOut, UserPlus, QrCode, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { subscribeToPOS } from "@/lib/realtime/subscriptions";
import { getShopWindow } from "@/lib/utils";
import { installPOSAuthGuard } from "@/lib/pos-fetch";
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
const UpcomingDrawer    = dynamic(() => import("./upcoming-drawer").then(m => m.UpcomingDrawer),     { ssr: false });
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
  const router = useRouter();

  const qc                    = useQueryClient();
  const setTables             = usePOSStore((s) => s.setTables);
  const setOpenOrders         = usePOSStore((s) => s.setOpenOrders);
  const setBookings           = usePOSStore((s) => s.setBookings);
  const handleOrderItemChange = usePOSStore((s) => s.handleOrderItemChange);
  const handleOrderChange     = usePOSStore((s) => s.handleOrderChange);
  const handleTableChange     = usePOSStore((s) => s.handleTableChange);
  const setWalkInOpen         = usePOSStore((s) => s.setWalkInOpen);
  const setCheckinOpen        = usePOSStore((s) => s.setCheckinOpen);
  const setUpcomingDrawerOpen = usePOSStore((s) => s.setUpcomingDrawerOpen);
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

  // Global 401 guard — Supabase refresh tokens rotate, and a long-open POS
  // tab will eventually hit "Invalid Refresh Token" on its next mutation.
  // Without this, staff sees a generic "Failed to stop session" with no way
  // out. Patches window.fetch once; any /api/* 401 → toast + bounce to /login.
  useEffect(() => { installPOSAuthGuard(); }, []);

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
  const { data: liveLoc } = useQuery<{ opening_time: string; closing_time: string } | null>({
    queryKey: ["pos-location", locationId],
    queryFn: async () => {
      const res = await fetch("/api/locations", { cache: "no-store" });
      const body = await res.json();
      const list = body.success ? body.data : [];
      const found = list.find((l: any) => l.id === locationId);
      return found ? { opening_time: found.opening_time, closing_time: found.closing_time } : null;
    },
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const effectiveOpeningTime = liveLoc?.opening_time ?? openingTime;
  const effectiveClosingTime = liveLoc?.closing_time ?? closingTime;

  useEffect(() => {
    usePOSStore.setState({ openingTime: effectiveOpeningTime, closingTime: effectiveClosingTime });
  }, [effectiveOpeningTime, effectiveClosingTime]);

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
    // Bookings have a tighter SLA than tables/orders because a customer
    // expects their booking to appear on the staff side as soon as payment
    // clears. Realtime is still the primary path, but we don't trust it to
    // be perfectly available (publication setup, transient socket drops,
    // RLS gotchas). 30s safety-net + on-focus refetch guarantees the UI
    // catches up fast in any failure mode.
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
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
      onExtrasChange: (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload as { eventType: string; new: { order_id: string }; old: { order_id: string } };
        const orderId = eventType === "DELETE" ? oldRow?.order_id : newRow?.order_id;
        if (!orderId) return;
        const hasOrder = usePOSStore.getState().openOrders.some((o) => o.id === orderId);
        if (hasOrder) {
          qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
        }
      },
    });
    return unsubscribe;
  }, [locationId, handleOrderItemChange, handleOrderChange, handleTableChange, qc]);

  // Hydrate the store from the network cache whenever a refetch lands.
  // Zustand store actions and realtime handlers automatically derive tables status internally,
  // preventing cascading render loops and ensuring instant card flips.
  useEffect(() => { if (rawTables) setTables(rawTables); }, [rawTables, setTables]);
  useEffect(() => { if (rawOrders) setOpenOrders(rawOrders); }, [rawOrders, setOpenOrders]);
  useEffect(() => { if (rawBookings) setBookings(rawBookings); }, [rawBookings, setBookings]);

  // Upcoming bookings header badge — uses Date.now() inline since POSScreen
  // doesn't subscribe to the 1s clock. The thresholds (30 min) are coarse
  // enough that exact second precision doesn't matter; the count updates
  // whenever rawBookings refetches (every 30s or on realtime).
  const { upcomingTotal, soonCount } = (() => {
    if (!rawBookings) return { upcomingTotal: 0, soonCount: 0 };
    const nowMs = Date.now();
    const thirtyMinFromNow = nowMs + 30 * 60 * 1000;
    let total = 0;
    let soon  = 0;
    for (const b of rawBookings) {
      const oi = b.order_item as { status?: string } | null;
      if (oi?.status !== "scheduled") continue;
      const startMs = new Date(b.scheduled_start).getTime();
      // Count only future bookings; if start has passed and not checked in, it's late but still relevant
      if (startMs >= nowMs - 30 * 60 * 1000) total++;
      if (startMs >= nowMs && startMs <= thirtyMinFromNow) soon++;
    }
    return { upcomingTotal: total, soonCount: soon };
  })();

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
    // No outer dark/flex wrapper — that's owned by app/(pos)/pos/layout.tsx
    // so the side rail stays mounted across /pos, /pos/bookings, /pos/inventory.
    <>
      {/* Sign-out overlay — back-button protection still routes here */}
      {signingOut && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <LogOut className="h-8 w-8 text-[#D4541A] animate-pulse mb-4" />
          <p className="text-white text-base font-semibold tracking-wide">Signing out…</p>
        </div>
      )}

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <header className="shrink-0 flex items-center justify-between px-5 h-14 bg-white dark:bg-[#111] border-b border-gray-200 dark:border-[#1f1f1f]">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-extrabold text-gray-900 dark:text-white text-sm tracking-tight">
              {locationName}
            </span>
            <span className="text-[#555] font-bold">·</span>
            <span className="text-xs font-medium text-[#888]">{staffName}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCheckinOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-700 dark:text-white transition-all border border-gray-200 dark:border-[#333] hover:border-gray-300 dark:hover:border-[#555] hover:bg-gray-50 dark:hover:bg-[#1e1e1e]"
            >
              <QrCode className="h-3.5 w-3.5" />
              Check-in
            </button>
            <button
              onClick={() => setUpcomingDrawerOpen(true)}
              className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-700 dark:text-white transition-all border border-gray-200 dark:border-[#333] hover:border-gray-300 dark:hover:border-[#555] hover:bg-gray-50 dark:hover:bg-[#1e1e1e]"
              title="Today's upcoming bookings"
            >
              <CalendarClock className="h-3.5 w-3.5" />
              {upcomingTotal > 0 ? `${upcomingTotal} upcoming` : "Upcoming"}
              {soonCount > 0 && (
                <span
                  className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-extrabold tabular-nums"
                  style={{ background: "#f59e0b", color: "#000" }}
                >
                  {soonCount} soon
                </span>
              )}
            </button>
            <button
              onClick={() => {
                // Compute on click — no per-second subscription needed in the
                // header. Worst case the button looks enabled for one minute
                // after closing; the toast catches it. Server enforces it too.
                const win = getShopWindow(new Date(), effectiveOpeningTime, effectiveClosingTime);
                if (win.outsideHours) {
                  toast.error(win.beforeOpen
                    ? `Shop opens at ${effectiveOpeningTime} — walk-ins disabled`
                    : "Shop closed for the day — walk-ins disabled");
                  return;
                }
                setWalkInOpen(true);
              }}
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
            className="shrink-0 border-l border-gray-200 dark:border-[#1f1f1f] overflow-hidden flex flex-col bg-white dark:bg-[#111]"
            style={{
              width:      showContextPanel ? 380 : 0,
              transition: "width 0.25s ease",
            }}
          >
            <div style={{ width: 380, height: "100%" }}>
              {showContextPanel && <ContextPanel locationId={locationId} closingTime={closingTime} />}
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
      <UpcomingDrawer locationId={locationId} />
    </>
  );
}
