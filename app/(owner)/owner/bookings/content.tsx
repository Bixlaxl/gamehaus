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

type TableRef = { name: string; type: string; location: { name: string; id: string } };
type BookingRow = Booking & {
  order: {
    customer_name: string;
    customer_phone: string | null;
    advance_paid: number;
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
    hour: "2-digit", minute: "2-digit", hour12: false,
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
  const [refundBooking, setRefund] = useState<BookingRow | null>(null);
  const [manualOpen,    setManualOpen] = useState(false);

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

  const groupedBookings = useMemo(() => {
    const groups: Record<string, BookingRow[]> = {};
    for (const b of filtered) {
      const key = b.order_id || b.id;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(b);
    }
    return Object.values(groups).map((groupList) => {
      groupList.sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime());
      const first = groupList[0];
      return {
        id: first.order_id || first.id,
        customer_name: first.order?.customer_name ?? "—",
        customer_phone: first.order?.customer_phone ?? null,
        advance_paid: first.order?.advance_paid ?? 0,
        location_name: first.order_item?.table?.location?.name ?? "—",
        bookings: groupList,
      };
    });
  }, [filtered]);

  return (
    <div className="space-y-6">
      {/* Header — only the List view is kept; Schedule was the same data minus
          the Location column, so it was redundant for multi-location owners. */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Bookings</h1>
        {mode === "staff" && staffLocationId && (
          <button
            onClick={() => setManualOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold text-white bg-[#D4541A] hover:opacity-90 transition-opacity"
          >
            <CalendarPlus className="h-4 w-4" />
            Manual booking
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shiftDate(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="relative">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-10 opacity-0 absolute inset-0 cursor-pointer"
            />
            <div className="flex items-center gap-1.5 px-3 h-9 rounded-md border border-input bg-background text-sm font-medium min-w-[160px] justify-center pointer-events-none">
              {displayDate}
              {isToday && <span className="text-[10px] font-bold text-orange-500 uppercase">Today</span>}
            </div>
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shiftDate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <Select value={locationFilter} onValueChange={setLoc}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations?.map((l) => (
              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setType}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tableTypes.map((t) => (
              <SelectItem key={t} value={t}>{TYPE_LABELS[t] ?? t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => void refetch()}
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
        </Button>
        <span className="text-xs font-semibold text-gray-700">
          {filtered.length} booking{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Outside-hours banner — only on staff mode when the shop isn't open */}
      {mode === "staff" && !actionsAllowed && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs font-semibold px-3 py-2">
          {actionsBlockedReason}. Check-in and No-show are disabled until the shop is open.
        </div>
      )}

      {/* Bookings list — single view (Location column included) */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 uppercase text-[11px] tracking-wide">Customer</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 uppercase text-[11px] tracking-wide">Booked Slots (Table & Time)</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 uppercase text-[11px] tracking-wide">Location</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 uppercase text-[11px] tracking-wide">Advance</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 uppercase text-[11px] tracking-wide">Status & Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {groupedBookings.map((g) => {
                return (
                  <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      <span>{g.customer_name}</span>
                      {g.customer_phone && (
                        <span className="text-xs text-gray-500 font-normal ml-1.5">({g.customer_phone})</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1.5 py-1">
                        {g.bookings.map((b) => {
                          const table = b.order_item?.table as TableRef | null;
                          return (
                            <div key={b.id} className="flex items-center gap-2 h-7 text-sm">
                              <span className="inline-flex items-center justify-center font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 dark:bg-[#1a1a1a] text-gray-700 dark:text-gray-300">
                                {fmt(b.scheduled_start)} – {fmt(b.scheduled_end)}
                              </span>
                              <span className="text-gray-900 font-medium">
                                <span className="mr-1">{TYPE_ICON[table?.type ?? ""] ?? "🎯"}</span>
                                {table?.name ?? "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-medium vertical-middle align-middle">{g.location_name}</td>
                    <td className="px-4 py-3 text-gray-900 font-bold tabular-nums align-middle">
                      {g.advance_paid > 0 ? `₹${Math.round(g.advance_paid)}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1.5 py-1">
                        {g.bookings.map((b) => (
                          <div key={b.id} className="flex items-center justify-between gap-4 h-7 min-w-[220px]">
                            <Badge
                              variant={
                                b.status === "confirmed"  ? "success"     :
                                b.status === "checked_in" ? "outline"     :
                                (b.status === "finished" || b.status === "completed") ? "secondary" :
                                b.status === "no_show"    ? "destructive" : "secondary"
                              }
                            >
                              {STATUS_LABELS[b.status] ?? b.status}
                            </Badge>
                            <div className="flex items-center gap-1.5">
                              {(b.status === "no_show" || b.status === "cancelled") && (
                                <Button variant="outline" size="sm" className="h-7 text-[11px] px-2" onClick={() => setRefund(b)}>
                                  Refund
                                </Button>
                              )}
                              {mode === "staff" && b.status === "confirmed" && (
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    className="h-7 text-[11px] px-2 bg-emerald-600 hover:bg-emerald-500 text-white"
                                    onClick={() => doCheckIn(b)}
                                    disabled={!actionsAllowed || busyBookingId === b.id}
                                    title={!actionsAllowed ? actionsBlockedReason : "Check in this slot"}
                                  >
                                    {busyBookingId === b.id ? "…" : "Check in"}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-[11px] px-2"
                                    onClick={() => doNoShow(b)}
                                    disabled={!actionsAllowed || busyBookingId === b.id}
                                    title={!actionsAllowed ? actionsBlockedReason : "Mark as no-show"}
                                  >
                                    {busyBookingId === b.id ? "…" : "No-show"}
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!isLoading && groupedBookings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500 font-medium">
                    No bookings for this date
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      {/* Refund dialog */}
      <Dialog open={!!refundBooking} onOpenChange={() => setRefund(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Process Refund</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-gray-600">
            <p>Customer: <strong>{refundBooking?.order?.customer_name}</strong></p>
            <p>Phone: <strong>{refundBooking?.order?.customer_phone ?? "—"}</strong></p>
            <p>
              Booking:{" "}
              <strong>
                {refundBooking ? `${fmt(refundBooking.scheduled_start)} – ${fmt(refundBooking.scheduled_end)}` : "—"}
              </strong>
            </p>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-amber-800 text-xs leading-relaxed">
              Online bookings are prepaid via Razorpay. Process the refund in your{" "}
              <strong>Razorpay Dashboard → Payments → Refunds</strong>, then mark it resolved here.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefund(null)}>Close</Button>
            <Button onClick={() => setRefund(null)}>Mark Resolved</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {manualOpen && staffLocationId && (
        <ManualBookingModal
          locationId={staffLocationId}
          defaultDate={date}
          onClose={() => setManualOpen(false)}
          onCreated={() => { setManualOpen(false); void refetch(); }}
        />
      )}
    </div>
  );
}

