"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, RefreshCw, CheckCircle2, XCircle, CalendarPlus } from "lucide-react";
import { ManualBookingModal } from "@/components/pos/manual-booking-modal";
import { cn, getShopWindow } from "@/lib/utils";
import { toast } from "sonner";
import type { Booking, Order, Location } from "@/lib/supabase/types";

const supabase = createClient();

type TableRef = { id: string; name: string; type: string; location: { name: string; id: string } };
type BookingRow = Booking & {
  order: {
    customer_name: string;
    customer_phone: string | null;
    advance_paid: number;
    type: string;
    status: string;
    subtotal: number | null;
    discount_amount: number;
    public_discount_amount?: number;
    total_amount: number | null;
    points_redeemed: number;
    points_redeemed_online?: number;
    order_items?: Array<{ id: string; status: string }> | null;
  } | null;
  order_item: { table: TableRef } | null;
};

const TYPE_LABELS: Record<string, string> = {
  all: "All types", snooker: "Snooker", pool: "Pool", ps5: "PS5", foosball: "Foosball",
};
const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed", checked_in: "Checked in", finished: "Finished", completed: "Finished", no_show: "No show", cancelled: "Cancelled",
};
const STATUS_DOT: Record<string, string> = {
  confirmed:  "bg-green-500",
  checked_in: "bg-blue-500",
  finished:   "bg-purple-500",
  completed:  "bg-purple-500",
  no_show:    "bg-red-500",
  cancelled:  "bg-gray-400",
};
const TYPE_ICON: Record<string, string> = {
  snooker: "🎱", pool: "🎱", ps5: "🎮", foosball: "⚽",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

export function BookingsContent({
  initialLocations,
  initialBookings,
  mode = "owner",
  staffLocationId,
}: {
  initialLocations: Pick<Location, "id" | "name" | "opening_time" | "closing_time">[];
  initialBookings: BookingRow[];
  /** When 'staff', the rows show Check-in / No-show action buttons (gated by
   *  the location's operating hours). 'owner' is read-only management. */
  mode?: "owner" | "staff";
  /** Staff's own location_id — used to gate actions by THEIR operating hours
   *  even when their location is one of several in the list. */
  staffLocationId?: string;
}) {
  const qc = useQueryClient();
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);
  // Re-evaluate operating hours every 30s — fine grain for gating actions
  // (we don't need per-second precision; the user clicks a button, not a clock).
  const [actionTick, setActionTick] = useState(0);
  useEffect(() => {
    if (mode !== "staff") return;
    const id = setInterval(() => setActionTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [mode]);
  const [date, setDate]           = useState(new Date().toISOString().split("T")[0]);
  // The date this component was first mounted on. Used to decide whether the
  // SSR-passed initialBookings actually applies to the date the user is now
  // viewing. Without this gate, TanStack treats initialData as fresh for
  // every new queryKey, so switching to a previous date showed today's data
  // and never ran the fetch at all.
  const [initialDate]             = useState(date);
  const [locationFilter, setLoc]  = useState("all");
  const [typeFilter, setType]     = useState("all");
  const [statusFilter, setStatus] = useState("all");
  const [manualOpen,    setManualOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<BookingRow | null>(null);
  const [tablesList, setTablesList] = useState<any[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [targetTableId, setTargetTableId] = useState("");
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!selectedBooking) {
      setTablesList([]);
      setTargetTableId("");
      return;
    }
    const orderItem = selectedBooking.order_item;
    const tableName = (orderItem?.table?.name ?? "").toLowerCase();
    if (!tableName.includes("medium")) return;

    const locId = selectedBooking.order_item?.table?.location?.id;
    if (!locId) return;

    setLoadingTables(true);
    fetch(`/api/tables?location_id=${locId}`)
      .then(res => res.json())
      .then(body => {
        if (body.success) {
          setTablesList(body.data ?? []);
        }
      })
      .catch(err => console.error("Failed to load tables:", err))
      .finally(() => setLoadingTables(false));
  }, [selectedBooking]);

  const otherMediumTables = useMemo(() => {
    if (!selectedBooking) return [];
    const currentTableId = selectedBooking.order_item?.table?.id;
    return tablesList.filter(
      (t) =>
        t.id !== currentTableId &&
        (t.name ?? "").toLowerCase().includes("medium")
    );
  }, [tablesList, selectedBooking]);

  function shiftDate(days: number) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().split("T")[0]);
  }

  const isToday      = date === new Date().toISOString().split("T")[0];
  const displayDate  = new Date(date + "T12:00:00").toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });

  const { data: locations } = useQuery({
    queryKey: ["locations", "active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("locations")
        .select("id, name, opening_time, closing_time")
        .eq("is_active", true);
      return (data ?? []) as Pick<Location, "id" | "name" | "opening_time" | "closing_time">[];
    },
    initialData: initialLocations,
    initialDataUpdatedAt: Date.now(),
    staleTime: 5 * 60 * 1000,
  });

  const opening = locations?.[0]?.opening_time ?? "10:00";
  const closing = locations?.[0]?.closing_time ?? "23:00";

  // Staff mode: action buttons are gated by THE STAFF'S OWN location hours.
  // Read the recompute trigger so this re-evaluates every 30s.
  void actionTick;
  const staffLoc = mode === "staff" && staffLocationId
    ? (locations ?? []).find((l) => l.id === staffLocationId) || (initialLocations ?? []).find((l) => l.id === staffLocationId)
    : null;
  const staffShop = staffLoc
    ? getShopWindow(new Date(), staffLoc.opening_time, staffLoc.closing_time)
    : null;
  const actionsAllowed = mode !== "staff" || (staffShop !== null && !staffShop.outsideHours);
  const actionsBlockedReason = staffShop?.outsideHours
    ? (staffShop.beforeOpen ? `Shop opens at ${staffLoc?.opening_time}` : "Shop is closed")
    : "";

  async function doCheckIn(b: BookingRow) {
    setBusyBookingId(b.id);
    const res = await fetch(`/api/bookings/${b.id}/checkin`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      toast.error(body.error ?? "Check-in failed");
    } else {
      toast.success("Checked in");
      void refetch();
      // Realtime usually catches this on the Tables page, but invalidate
      // the POS caches too so a quick tab back shows the running session.
      qc.invalidateQueries({ queryKey: ["pos-orders"] });
      qc.invalidateQueries({ queryKey: ["pos-bookings"] });
      qc.invalidateQueries({ queryKey: ["owner-bookings"] });
      qc.invalidateQueries({ queryKey: ["staff-bookings"] });
      qc.invalidateQueries({ queryKey: ["manual-table-slots"] });
    }
    setBusyBookingId(null);
  }

  async function doNoShow(b: BookingRow) {
    if (!confirm(`Mark ${b.order?.customer_name ?? "this customer"} as no-show? The slot will be freed.`)) return;
    setBusyBookingId(b.id);
    const res = await fetch(`/api/bookings/${b.id}/noshow`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      toast.error(body.error ?? "Failed to mark no-show");
    } else {
      toast.success("Marked no-show");
      void refetch();
      qc.invalidateQueries({ queryKey: ["pos-bookings"] });
      qc.invalidateQueries({ queryKey: ["owner-bookings"] });
      qc.invalidateQueries({ queryKey: ["staff-bookings"] });
      qc.invalidateQueries({ queryKey: ["manual-table-slots"] });
    }
    setBusyBookingId(null);
  }

  const { data: bookings, isLoading, refetch } = useQuery({
    queryKey: ["owner-bookings", date, opening, closing],
    queryFn: async () => {
      const [openH, openM]   = opening.split(":").map(Number);
      const [closeH, closeM] = closing.split(":").map(Number);
      const crossesMidnight  = closeH < openH || (closeH === openH && closeM < openM);
      const from = new Date(`${date}T${opening}+05:30`).toISOString();
      const closeDate = crossesMidnight
        ? (() => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().split("T")[0]; })()
        : date;
      const to = new Date(`${closeDate}T${closing}+05:30`).toISOString();

      // Server-side admin query — bypasses RLS. Previously this used the
      // browser Supabase client which silently returned [] on date change
      // when RLS denied SELECT to the anon role, making it look like the
      // page needed a reload to update.
      const res = await fetch(
        `/api/owner/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: "no-store" }
      );
      const body = await res.json() as
        | { success: true;  data: BookingRow[] }
        | { success: false; error: string };
      return body.success ? body.data : [];
    },
    // Only apply the SSR-passed initialBookings when the visible date actually
    // matches the date the SSR rendered. Otherwise TanStack treats this static
    // value as fresh data for the new queryKey too and skips the fetch.
    initialData: date === initialDate ? initialBookings : undefined,
    initialDataUpdatedAt: date === initialDate ? Date.now() : undefined,
    staleTime: 15 * 1000,
    placeholderData: keepPreviousData,
    // Owner has no realtime sub for /owner/bookings the way staff POS does.
    // 30s safety-net + on-focus refetch keeps the list fresh enough that a
    // new customer booking shows up almost instantly even if realtime is off.
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  // Realtime: any change to the bookings table triggers an immediate refetch.
  // Belt-and-suspenders alongside the 30s poll — when the Supabase publication
  // is configured correctly this gives sub-second update; when it isn't, the
  // poll still catches it within 30s.
  useEffect(() => {
    const channel = supabase
      .channel("owner-bookings")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => {
        void refetch();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refetch]);

  const tableTypes = useMemo(() => {
    const typesSet = new Set(["snooker", "pool", "ps5", "foosball"]);
    if (bookings) {
      for (const b of bookings) {
        const t = b.order_item?.table;
        if (t?.type) {
          typesSet.add(t.type);
        }
      }
    }
    return ["all", ...typesSet];
  }, [bookings]);

  const filtered = useMemo(() => (bookings ?? []).filter((b) => {
    const table = b.order_item?.table as TableRef | null;
    if (locationFilter !== "all" && table?.location?.id !== locationFilter) return false;
    if (typeFilter     !== "all" && table?.type !== typeFilter) return false;
    if (statusFilter   !== "all" && b.status !== statusFilter) return false;
    return true;
  }), [bookings, locationFilter, typeFilter, statusFilter]);

  const bookingsByTable = useMemo(() => {
    const groups: Record<string, { table: TableRef; bookings: BookingRow[] }> = {};
    for (const b of filtered) {
      const table = b.order_item?.table as TableRef | null;
      if (!table) continue;
      const tableId = table.id;
      if (!groups[tableId]) {
        groups[tableId] = {
          table,
          bookings: [],
        };
      }
      groups[tableId].bookings.push(b);
    }
    return Object.values(groups)
      .map((g) => {
        g.bookings.sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime());
        return g;
      })
      .sort((a, b) => a.table.name.localeCompare(b.table.name));
  }, [filtered]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">Bookings</h1>
        {mode === "staff" && staffLocationId && (
          <button
            onClick={() => setManualOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-base font-extrabold text-white bg-[#D4541A] hover:opacity-90 transition-opacity shadow-sm"
          >
            <CalendarPlus className="h-5 w-5" />
            Manual booking
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => shiftDate(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="relative">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-10 opacity-0 absolute inset-0 cursor-pointer"
            />
            <div className="flex items-center gap-2 px-4 h-11 rounded-lg border border-input bg-background text-base font-semibold min-w-[200px] justify-center pointer-events-none">
              {displayDate}
              {isToday && <span className="text-[11px] font-extrabold text-orange-500 uppercase tracking-wide">Today</span>}
            </div>
          </div>
          <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => shiftDate(1)}>
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        <Select value={locationFilter} onValueChange={setLoc}>
          <SelectTrigger className="w-48 h-11 text-base font-medium">
            <SelectValue placeholder="All locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-base font-medium">All locations</SelectItem>
            {locations?.map((l) => (
              <SelectItem key={l.id} value={l.id} className="text-base font-medium">{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setType}>
          <SelectTrigger className="w-44 h-11 text-base font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tableTypes.map((t) => (
              <SelectItem key={t} value={t} className="text-base font-medium">
                {TYPE_LABELS[t] ?? t.charAt(0).toUpperCase() + t.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="w-44 h-11 text-base font-medium">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-base font-medium">All statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v} className="text-base font-medium">{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={() => void refetch()}
        >
          <RefreshCw className={cn("h-5 w-5", isLoading && "animate-spin")} />
        </Button>
        <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
          {filtered.length} booking{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Outside-hours banner */}
      {mode === "staff" && !actionsAllowed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-400 text-sm font-bold px-4 py-3 leading-relaxed">
          {actionsBlockedReason}. Check-in and No-show are disabled until the shop is open.
        </div>
      )}

      {/* Bookings grouped by Table */}
      <div className="space-y-8">
        {bookingsByTable.map((group) => {
          const { table, bookings: tableBookings } = group;
          return (
            <div
              key={table.id}
              className="bg-white dark:bg-[#161616] rounded-2xl border border-gray-200 dark:border-[#222] shadow-sm overflow-hidden p-4 md:p-6 space-y-4"
            >
              {/* Table Name Header */}
              <div className="flex items-center justify-between border-b border-gray-200 dark:border-[#222] pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xl md:text-2xl font-black text-gray-900 dark:text-white">
                    <span className="mr-2">{TYPE_ICON[table.type] ?? "🎱"}</span>
                    {table.name}
                  </span>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-[#222] text-gray-600 dark:text-gray-400">
                    {table.location.name}
                  </span>
                </div>
                <span className="text-sm md:text-base font-bold text-gray-500 dark:text-gray-400">
                  {tableBookings.length} slot{tableBookings.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Mobile View (stacked cards) */}
              <div className="block md:hidden space-y-4">
                {tableBookings.map((b) => (
                  <div
                    key={b.id}
                    onClick={() => setSelectedBooking(b)}
                    className="border border-gray-150 dark:border-[#222] rounded-2xl p-4 bg-gray-50/50 dark:bg-[#161616] space-y-4 cursor-pointer hover:bg-gray-100/50 dark:hover:bg-[#1f1f1f]/30 transition-colors"
                  >
                    {/* Time Slot & Status */}
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <span className="font-mono text-base font-black px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-[#222] text-gray-700 dark:text-gray-300 border dark:border-[#333] shadow-sm">
                        {fmt(b.scheduled_start)} – {fmt(b.scheduled_end)}
                      </span>
                      <Badge
                        className="px-4 py-1.5 text-sm font-black rounded-xl"
                        variant={
                          b.status === "confirmed"  ? "success"     :
                          b.status === "checked_in" ? "outline"     :
                          (b.status === "finished" || b.status === "completed") ? "secondary" :
                          b.status === "no_show"    ? "destructive" : "secondary"
                        }
                      >
                        {STATUS_LABELS[b.status] ?? b.status}
                      </Badge>
                    </div>

                    {/* Customer Info */}
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Customer</p>
                      <p className="text-xl font-black text-gray-900 dark:text-white">{b.order?.customer_name ?? "—"}</p>
                      {b.order?.customer_phone && (
                        <p className="text-base font-bold text-gray-600 dark:text-gray-450 mt-0.5">{b.order.customer_phone}</p>
                      )}
                    </div>

                    {/* Advance paid */}
                    {b.order?.advance_paid && b.order.advance_paid > 0 ? (
                      <div className="text-sm bg-white dark:bg-[#111] p-3 rounded-xl border dark:border-gray-800">
                        <p className="text-gray-450 font-bold text-[11px] uppercase">Advance Paid</p>
                        <p className="font-black text-gray-900 dark:text-white mt-0.5">
                          ₹{Math.round(b.order.advance_paid)}
                        </p>
                      </div>
                    ) : null}

                    {/* Actions */}
                    {mode === "staff" && b.status === "confirmed" && (
                      <div className="flex gap-2.5 pt-1">
                        <Button
                          size="sm"
                          disabled={busyBookingId === b.id || !actionsAllowed}
                          onClick={(e) => { e.stopPropagation(); void doCheckIn(b); }}
                          className="flex-1 h-12 text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl"
                        >
                          {busyBookingId === b.id ? "…" : "Check-in"}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busyBookingId === b.id || !actionsAllowed}
                          onClick={(e) => { e.stopPropagation(); void doNoShow(b); }}
                          className="flex-1 h-12 text-sm font-black rounded-xl"
                        >
                          {busyBookingId === b.id ? "…" : "No-show"}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop View (HTML Table) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-base">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-[#222] text-left">
                      <th className="px-4 py-4.5 font-black text-gray-600 dark:text-gray-400 uppercase text-sm tracking-wider">Time Slot</th>
                      <th className="px-4 py-4.5 font-black text-gray-600 dark:text-gray-400 uppercase text-sm tracking-wider">Customer Name</th>
                      <th className="px-4 py-4.5 font-black text-gray-600 dark:text-gray-400 uppercase text-sm tracking-wider">Phone Number</th>
                      <th className="px-4 py-4.5 font-black text-gray-600 dark:text-gray-400 uppercase text-sm tracking-wider">Advance Paid</th>
                      <th className="px-4 py-4.5 font-black text-gray-600 dark:text-gray-400 uppercase text-sm tracking-wider">Status & Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-[#222]">
                    {tableBookings.map((b) => (
                      <tr
                        key={b.id}
                        onClick={() => setSelectedBooking(b)}
                        className="hover:bg-gray-50 dark:hover:bg-[#1f1f1f]/50 transition-colors cursor-pointer"
                      >
                        {/* Time Slot */}
                        <td className="px-4 py-5 font-semibold text-gray-900 dark:text-white align-middle">
                          <span className="inline-flex items-center justify-center font-mono text-xl md:text-2xl font-black px-6 py-3.5 rounded-2xl bg-gray-100 dark:bg-[#222] text-gray-700 dark:text-gray-300 border-2 border-gray-250 dark:border-[#444] shadow-sm">
                            {fmt(b.scheduled_start)} – {fmt(b.scheduled_end)}
                          </span>
                        </td>

                        {/* Customer Name */}
                        <td className="px-4 py-5 align-middle">
                          <span className="font-black text-gray-900 dark:text-white text-2xl md:text-3xl">{b.order?.customer_name ?? "—"}</span>
                        </td>

                        {/* Phone Number */}
                        <td className="px-4 py-5 align-middle">
                          {b.order?.customer_phone ? (
                            <span className="text-2xl md:text-3xl text-gray-900 dark:text-white font-black">{b.order.customer_phone}</span>
                          ) : (
                            <span className="text-2xl md:text-3xl text-gray-450 dark:text-gray-500 font-bold">—</span>
                          )}
                        </td>

                        {/* Advance Paid */}
                        <td className="px-4 py-5 text-gray-950 dark:text-gray-100 font-black tabular-nums text-2xl md:text-3xl align-middle">
                          {b.order?.advance_paid && b.order.advance_paid > 0 ? `₹${Math.round(b.order.advance_paid)}` : "—"}
                        </td>

                        {/* Status & Actions */}
                        <td className="px-4 py-5 align-middle">
                          <div className="flex items-center justify-start gap-6">
                            <Badge
                              className="px-6 py-3.5 text-xl md:text-2xl font-black shrink-0 rounded-2xl"
                              variant={
                                b.status === "confirmed"  ? "success"     :
                                b.status === "checked_in" ? "outline"     :
                                (b.status === "finished" || b.status === "completed") ? "secondary" :
                                b.status === "no_show"    ? "destructive" : "secondary"
                              }
                            >
                              {STATUS_LABELS[b.status] ?? b.status}
                            </Badge>
                            <div className="flex items-center gap-2">
                              {mode === "staff" && b.status === "confirmed" && (
                                <div className="flex items-center gap-3">
                                  <Button
                                    size="default"
                                    className="h-16 text-xl px-8 font-black bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm rounded-2xl"
                                    onClick={(e) => { e.stopPropagation(); void doCheckIn(b); }}
                                    disabled={!actionsAllowed || busyBookingId === b.id}
                                    title={!actionsAllowed ? actionsBlockedReason : "Check in this slot"}
                                  >
                                    {busyBookingId === b.id ? "…" : "Check in"}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="default"
                                    className="h-16 text-xl px-8 font-black text-gray-500 hover:text-red-500 hover:border-red-200 rounded-2xl"
                                    onClick={(e) => { e.stopPropagation(); void doNoShow(b); }}
                                    disabled={!actionsAllowed || busyBookingId === b.id}
                                    title={!actionsAllowed ? actionsBlockedReason : "Mark as no-show"}
                                  >
                                    {busyBookingId === b.id ? "…" : "No-show"}
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {!isLoading && bookingsByTable.length === 0 && (
        <div className="bg-white dark:bg-[#161616] rounded-2xl border border-gray-200 dark:border-[#222] shadow-sm p-12 text-center text-lg text-gray-500 dark:text-gray-400 font-semibold">
          No bookings for this date
        </div>
      )}



      {manualOpen && staffLocationId && (
        <ManualBookingModal
          locationId={staffLocationId}
          defaultDate={date}
          onClose={() => setManualOpen(false)}
          onCreated={() => { setManualOpen(false); void refetch(); }}
        />
      )}

      {/* Booking Details Breakdown Modal */}
      <Dialog open={!!selectedBooking} onOpenChange={(open) => !open && setSelectedBooking(null)}>
        <DialogContent className="max-w-2xl p-10 bg-white dark:bg-[#111] border border-gray-200 dark:border-[#2A2A2A] rounded-3xl shadow-2xl">
          <DialogHeader className="pb-6 border-b border-gray-100 dark:border-[#222]">
            <DialogTitle className="text-3xl font-black text-gray-900 dark:text-white flex items-center justify-between">
              <span>Booking Details</span>
              <span className="text-sm font-black px-4 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 uppercase tracking-wider">
                {selectedBooking?.order?.type || "Walk-in"}
              </span>
            </DialogTitle>
          </DialogHeader>

          {selectedBooking && (() => {
            const b = selectedBooking;
            const order = b.order;
            const table = b.order_item?.table;
            const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
            const formatD = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
            
            const baseSubtotal = order?.subtotal ?? 0;
            const discount = order?.discount_amount ?? 0;
            const advance = order?.advance_paid ?? 0;
            const total = order?.total_amount ?? 0;
            
            const pubDisc = order?.public_discount_amount ?? 0;
            const memDisc = Math.max(0, discount - pubDisc);
            
            const ptsRedeemed = order?.points_redeemed ?? 0;
            const ptsRedeemedOnline = order?.points_redeemed_online ?? 0;
            const ptsRedeemedVenue = Math.max(0, ptsRedeemed - ptsRedeemedOnline);

            const durationMins = Math.round((new Date(b.scheduled_end).getTime() - new Date(b.scheduled_start).getTime()) / 60000);
            const formatDuration = (mins: number) => {
              const h = Math.floor(mins / 60);
              const m = mins % 60;
              return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
            };

            const isFinalized = order?.status === "finalized";
            const amountPaid = isFinalized ? total : advance;
            const remainingDue = isFinalized ? 0 : Math.max(0, total - advance);

            return (
              <div className="space-y-8 pt-6 text-left">
                {/* Slot & Table info */}
                <div className="bg-gray-50 dark:bg-[#161616] p-6 rounded-2xl space-y-3 border dark:border-[#222]">
                  <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Resource & Slot</p>
                  <p className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                    <span>{table?.name || "Table"}</span>
                    <span className="text-sm font-bold text-gray-500">({table?.type})</span>
                  </p>
                  <p className="text-base font-semibold text-gray-600 dark:text-gray-400">
                    {formatD(b.scheduled_start)} at {formatTime(b.scheduled_start)} – {formatTime(b.scheduled_end)} ({formatDuration(durationMins)})
                  </p>
                </div>

                {/* Customer Details */}
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Customer</p>
                  <p className="text-2xl font-black text-gray-900 dark:text-white">{order?.customer_name || "Guest"}</p>
                  {order?.customer_phone && (
                    <p className="text-base font-bold text-gray-500">{order.customer_phone}</p>
                  )}
                </div>

                {/* Calculation Breakdown */}
                <div className="space-y-4 border-t border-gray-100 dark:border-[#222] pt-6">
                  <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest pb-1">Price Calculation</p>
                  
                  <div className="flex justify-between text-base font-semibold">
                    <span className="text-gray-500 dark:text-gray-400">Booking Subtotal</span>
                    <span className="tabular-nums font-bold text-gray-900 dark:text-white">₹{Math.round(baseSubtotal)}</span>
                  </div>

                  {pubDisc > 0 && (
                    <div className="flex justify-between text-base font-semibold text-emerald-600">
                      <span>Public Discount</span>
                      <span className="tabular-nums font-bold">−₹{Math.round(pubDisc)}</span>
                    </div>
                  )}

                  {memDisc > 0 && (
                    <div className="flex justify-between text-base font-semibold text-purple-600 dark:text-purple-400">
                      <span>Membership Discount</span>
                      <span className="tabular-nums font-bold">−₹{Math.round(memDisc)}</span>
                    </div>
                  )}

                  {ptsRedeemedOnline > 0 && (
                    <div className="flex justify-between text-base font-semibold text-amber-600">
                      <span>Points Redeemed (Online)</span>
                      <span className="tabular-nums font-bold">−₹{Math.round(ptsRedeemedOnline)}</span>
                    </div>
                  )}

                  {ptsRedeemedVenue > 0 && (
                    <div className="flex justify-between text-base font-semibold text-amber-600">
                      <span>Points Redeemed (At Venue)</span>
                      <span className="tabular-nums font-bold">−₹{Math.round(ptsRedeemedVenue)}</span>
                    </div>
                  )}

                  {advance > 0 && (
                    <div className="flex justify-between text-base font-semibold text-emerald-600">
                      <span>Advance Paid Online</span>
                      <span className="tabular-nums font-bold">−₹{Math.round(advance)}</span>
                    </div>
                  )}

                  <div className="flex justify-between border-t border-gray-100 dark:border-[#222] pt-4 text-xl font-black">
                    <span className="text-gray-900 dark:text-white">Amount Paid / Settled</span>
                    <span className="tabular-nums text-emerald-600 text-2xl">₹{Math.round(amountPaid)}</span>
                  </div>

                  {!isFinalized && remainingDue > 0 && (
                    <div className="flex justify-between border-t border-dashed border-gray-150 dark:border-[#222] pt-3 text-xl font-black">
                      <span className="text-gray-900 dark:text-white">Remaining Balance (Pay at Venue)</span>
                      <span className="tabular-nums text-[#D4541A] text-2xl">₹{Math.round(remainingDue)}</span>
                    </div>
                  )}

                  {otherMediumTables.length > 0 && (
                    <div className="space-y-3 border-t border-gray-100 dark:border-[#222] pt-6">
                      <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest pb-1">Switch Table (Medium Table Only)</p>
                      <div className="flex gap-4">
                        <select
                          value={targetTableId}
                          onChange={(e) => setTargetTableId(e.target.value)}
                          className="flex-1 h-14 px-4 text-base rounded-xl border border-input bg-background font-semibold text-gray-900 dark:text-white"
                        >
                          <option value="" className="text-gray-500 font-semibold">Select table...</option>
                          {otherMediumTables.map((t) => (
                            <option key={t.id} value={t.id} className="font-semibold">{t.name}</option>
                          ))}
                        </select>
                        <Button
                          size="default"
                          disabled={!targetTableId || switching}
                          onClick={async () => {
                            setSwitching(true);
                            try {
                              const res = await fetch("/api/pos/bookings/switch-table", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  booking_id: b.id,
                                  target_table_id: targetTableId,
                                }),
                              });
                              const body = await res.json();
                              if (body.success) {
                                toast.success("Table switched successfully!");
                                setSelectedBooking(null);
                                void refetch();
                              } else {
                                toast.error(body.error || "Failed to switch table");
                              }
                            } catch (err: any) {
                              toast.error(err?.message || "Failed to switch table");
                            } finally {
                              setSwitching(false);
                            }
                          }}
                          className="h-14 px-8 text-sm font-black bg-[#D4541A] hover:bg-[#b04312] text-white rounded-xl shadow-sm"
                        >
                          {switching ? "Switching..." : "Switch"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer Status badge */}
                <div className="pt-4 flex justify-between items-center text-base font-bold text-gray-500 border-t border-gray-100 dark:border-[#222]">
                  <span>Status</span>
                  <Badge
                    className="px-6 py-2.5 text-sm font-black rounded-xl"
                    variant={
                      b.status === "confirmed"  ? "success"     :
                      b.status === "checked_in" ? "outline"     :
                      (b.status === "finished" || b.status === "completed") ? "secondary" :
                      b.status === "no_show"    ? "destructive" : "secondary"
                    }
                  >
                    {STATUS_LABELS[b.status] ?? b.status}
                  </Badge>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

