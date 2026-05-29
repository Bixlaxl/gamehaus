"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
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
import { ChevronLeft, ChevronRight, LayoutList, CalendarDays, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Booking, Order, Location } from "@/lib/supabase/types";

const supabase = createClient();

type TableRef = { name: string; type: string; location: { name: string; id: string } };
type BookingRow = Booking & {
  order: Pick<Order, "customer_name" | "customer_phone" | "advance_paid">;
  order_item: { table: TableRef } | null;
};

const TABLE_TYPES = ["all", "snooker", "pool", "ps5", "foosball"] as const;
const TYPE_LABELS: Record<string, string> = {
  all: "All types", snooker: "Snooker", pool: "Pool", ps5: "PS5", foosball: "Foosball",
};
const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed", checked_in: "Checked in", no_show: "No show", cancelled: "Cancelled",
};
const STATUS_DOT: Record<string, string> = {
  confirmed:  "bg-green-500",
  checked_in: "bg-blue-500",
  no_show:    "bg-red-500",
  cancelled:  "bg-gray-400",
};
const TYPE_ICON: Record<string, string> = {
  snooker: "🎱", pool: "🎱", ps5: "🎮", foosball: "⚽",
};
const TYPE_ORDER: Record<string, number> = { snooker: 0, pool: 1, ps5: 2, foosball: 3 };

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function BookingsContent({
  initialLocations,
  initialBookings,
}: {
  initialLocations: Pick<Location, "id" | "name" | "opening_time" | "closing_time">[];
  initialBookings: BookingRow[];
}) {
  const [date, setDate]           = useState(new Date().toISOString().split("T")[0]);
  const [locationFilter, setLoc]  = useState("all");
  const [typeFilter, setType]     = useState("all");
  const [statusFilter, setStatus] = useState("all");
  const [viewMode, setViewMode]   = useState<"schedule" | "list">("schedule");
  const [refundBooking, setRefund] = useState<BookingRow | null>(null);

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
    queryKey: ["locations"],
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
      const { data } = await supabase
        .from("bookings")
        .select(`
          *,
          order:orders(customer_name, customer_phone, advance_paid),
          order_item:order_items(table:tables(name, type, location:locations(name, id)))
        `)
        .gte("scheduled_start", from)
        .lte("scheduled_start", to)
        .order("scheduled_start");
      return (data ?? []) as BookingRow[];
    },
    initialData: initialBookings,
    initialDataUpdatedAt: Date.now(),
    staleTime: 5 * 60 * 1000,
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

  const filtered = useMemo(() => (bookings ?? []).filter((b) => {
    const table = b.order_item?.table as TableRef | null;
    if (locationFilter !== "all" && table?.location?.id !== locationFilter) return false;
    if (typeFilter     !== "all" && table?.type !== typeFilter) return false;
    if (statusFilter   !== "all" && b.status !== statusFilter) return false;
    return true;
  }), [bookings, locationFilter, typeFilter, statusFilter]);

  const byTable = useMemo(() => {
    const map = new Map<string, { tableName: string; tableType: string; rows: BookingRow[] }>();
    for (const b of filtered) {
      const table = b.order_item?.table as TableRef | null;
      const key = table?.name ?? "Unknown";
      if (!map.has(key)) map.set(key, { tableName: key, tableType: table?.type ?? "", rows: [] });
      map.get(key)!.rows.push(b);
    }
    return [...map.values()].sort((a, b) => {
      const ao = TYPE_ORDER[a.tableType] ?? 9;
      const bo = TYPE_ORDER[b.tableType] ?? 9;
      return ao !== bo ? ao - bo : a.tableName.localeCompare(b.tableName);
    });
  }, [filtered]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Bookings</h1>
        <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 p-0.5 bg-gray-50">
          <Button
            variant={viewMode === "schedule" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setViewMode("schedule")}
          >
            <CalendarDays className="h-3.5 w-3.5 mr-1" />
            Schedule
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setViewMode("list")}
          >
            <LayoutList className="h-3.5 w-3.5 mr-1" />
            List
          </Button>
        </div>
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
            {TABLE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
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
        <span className="text-xs text-gray-400">
          {filtered.length} booking{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Schedule View */}
      {viewMode === "schedule" && (
        <div className="space-y-3">
          {!isLoading && byTable.length === 0 && (
            <div className="text-center py-12 text-gray-400 bg-white rounded-2xl border border-gray-100">
              No bookings for this date
            </div>
          )}
          {byTable.map(({ tableName, tableType, rows }) => (
            <div key={tableName} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 py-3 bg-gray-50/80 border-b border-gray-100">
                <span className="text-sm">{TYPE_ICON[tableType] ?? "🎱"}</span>
                <span className="font-semibold text-gray-900 text-sm">{tableName}</span>
                <Badge variant="outline" className="text-[10px] capitalize py-0">{typeType(tableType)}</Badge>
                <span className="ml-auto text-xs text-gray-400">
                  {rows.length} booking{rows.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="divide-y divide-gray-50">
                {rows.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 transition-colors">
                    <div className={cn("w-2 h-2 rounded-full shrink-0 mt-0.5", STATUS_DOT[b.status] ?? "bg-gray-300")} />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-gray-900 text-sm">{b.order?.customer_name}</span>
                      {b.order?.customer_phone && (
                        <span className="text-xs text-gray-400 ml-2">{b.order.customer_phone}</span>
                      )}
                    </div>
                    <span className="text-sm font-mono text-gray-600 tabular-nums shrink-0">
                      {fmt(b.scheduled_start)} – {fmt(b.scheduled_end)}
                    </span>
                    {(b.order?.advance_paid ?? 0) > 0 && (
                      <span className="text-xs bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-0.5 shrink-0">
                        ₹{b.order?.advance_paid} paid
                      </span>
                    )}
                    <Badge
                      variant={
                        b.status === "confirmed"  ? "success"     :
                        b.status === "checked_in" ? "outline"     :
                        b.status === "no_show"    ? "destructive" : "secondary"
                      }
                      className="shrink-0 text-[11px]"
                    >
                      {STATUS_LABELS[b.status] ?? b.status}
                    </Badge>
                    {(b.status === "no_show" || b.status === "cancelled") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs shrink-0"
                        onClick={() => setRefund(b)}
                      >
                        Refund
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List View */}
      {viewMode === "list" && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Time</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Table</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Location</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Advance</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((b) => {
                const table = b.order_item?.table as TableRef | null;
                return (
                  <tr key={b.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700 tabular-nums">
                      {fmt(b.scheduled_start)} – {fmt(b.scheduled_end)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{b.order?.customer_name}</p>
                      <p className="text-xs text-gray-500">{b.order?.customer_phone}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <span className="mr-1">{TYPE_ICON[table?.type ?? ""] ?? ""}</span>
                      {table?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{table?.location?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {(b.order?.advance_paid ?? 0) > 0 ? `₹${b.order?.advance_paid}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          b.status === "confirmed"  ? "success"     :
                          b.status === "checked_in" ? "outline"     :
                          b.status === "no_show"    ? "destructive" : "secondary"
                        }
                      >
                        {STATUS_LABELS[b.status] ?? b.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(b.status === "no_show" || b.status === "cancelled") && (
                        <Button variant="outline" size="sm" onClick={() => setRefund(b)}>
                          Process Refund
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    No bookings for this date
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

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
    </div>
  );
}

function typeType(t: string) {
  return t === "ps5" ? "PS5" : t.charAt(0).toUpperCase() + t.slice(1);
}
