"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Booking, Order, Location } from "@/lib/supabase/types";

const supabase = createClient();

type BookingRow = Booking & {
  order: Pick<Order, "customer_name" | "customer_phone">;
  order_item: { table: { name: string; location: { name: string; id: string } } };
};

const STATUS_OPTIONS = [
  { value: "all",        label: "All statuses" },
  { value: "confirmed",  label: "Confirmed" },
  { value: "checked_in", label: "Checked in" },
  { value: "no_show",    label: "No show" },
  { value: "cancelled",  label: "Cancelled" },
];

const statusVariant: Record<string, "success" | "secondary" | "destructive" | "outline"> = {
  confirmed:  "success",
  checked_in: "outline",
  no_show:    "destructive",
  cancelled:  "secondary",
};

export default function BookingsPage() {
  const qc = useQueryClient();
  const [date, setDate]               = useState(new Date().toISOString().split("T")[0]);

  function shiftDate(days: number) {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().split("T")[0]);
  }

  const isToday = date === new Date().toISOString().split("T")[0];
  const displayDate = new Date(date + "T12:00:00").toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short",
  });
  const [locationFilter, setLocation] = useState("all");
  const [statusFilter, setStatus]     = useState("all");
  const [refundBooking, setRefundBooking] = useState<BookingRow | null>(null);

  const { data: locations } = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("id, name, opening_time, closing_time").eq("is_active", true);
      return (data ?? []) as Pick<Location, "id" | "name" | "opening_time" | "closing_time">[];
    },
  });

  const opening = locations?.[0]?.opening_time ?? "10:00";
  const closing = locations?.[0]?.closing_time ?? "23:00";

  const { data: bookings, isLoading } = useQuery({
    queryKey: ["bookings", date, opening, closing],
    queryFn: async () => {
      const [openH, openM]   = opening.split(":").map(Number);
      const [closeH, closeM] = closing.split(":").map(Number);
      const crossesMidnight  = closeH < openH || (closeH === openH && closeM < openM);
      const from = new Date(`${date}T${opening}+05:30`).toISOString();
      // If closing crosses midnight, the end falls on the next calendar day
      const closeDate = crossesMidnight
        ? (() => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().split("T")[0]; })()
        : date;
      const to = new Date(`${closeDate}T${closing}+05:30`).toISOString();
      const { data } = await supabase
        .from("bookings")
        .select(`
          *,
          order:orders(customer_name, customer_phone),
          order_item:order_items(table:tables(name, location:locations(name, id)))
        `)
        .gte("scheduled_start", from)
        .lte("scheduled_start", to)
        .order("scheduled_start");
      return (data ?? []) as BookingRow[];
    },
  });

  const filtered = (bookings ?? []).filter((b) => {
    const loc = (b.order_item?.table?.location as { id: string; name: string } | null)?.id;
    if (locationFilter !== "all" && loc !== locationFilter) return false;
    if (statusFilter   !== "all" && b.status !== statusFilter) return false;
    return true;
  });

  function fmt(iso: string) {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Bookings</h1>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Date navigation */}
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
            <div className="flex items-center gap-1.5 px-3 h-9 rounded-md border border-input bg-background text-sm font-medium min-w-[120px] justify-center pointer-events-none">
              {displayDate}
              {isToday && <span className="text-[10px] font-bold text-orange-500 uppercase">Today</span>}
            </div>
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shiftDate(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Select value={locationFilter} onValueChange={setLocation}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations?.map((loc) => (
              <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatus}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-gray-400 ml-auto">
          {filtered.length} booking{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading && <p className="text-gray-500">Loading...</p>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Time</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Table</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Location</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-3 font-mono text-xs text-gray-700">
                  {fmt(b.scheduled_start)} – {fmt(b.scheduled_end)}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{b.order?.customer_name}</p>
                  <p className="text-xs text-gray-500">{b.order?.customer_phone}</p>
                </td>
                <td className="px-4 py-3 text-gray-700">{b.order_item?.table?.name}</td>
                <td className="px-4 py-3 text-gray-500">
                  {(b.order_item?.table?.location as { name: string } | null)?.name}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={statusVariant[b.status] ?? "outline"}>
                    {b.status.replace("_", " ")}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {(b.status === "no_show" || b.status === "cancelled") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRefundBooking(b)}
                    >
                      Process Refund
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No bookings for this date
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Refund dialog */}
      <Dialog open={!!refundBooking} onOpenChange={() => setRefundBooking(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Process Refund</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-gray-600">
            <p>
              Customer: <strong>{refundBooking?.order?.customer_name}</strong>
            </p>
            <p>
              Phone: <strong>{refundBooking?.order?.customer_phone ?? "—"}</strong>
            </p>
            <p>
              Booking:{" "}
              <strong>
                {refundBooking
                  ? `${fmt(refundBooking.scheduled_start)} – ${fmt(refundBooking.scheduled_end)}`
                  : "—"}
              </strong>
            </p>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-amber-800 text-xs leading-relaxed">
              Online bookings are prepaid via Razorpay. Process the refund in your{" "}
              <strong>Razorpay Dashboard → Payments → Refunds</strong>, then mark it
              resolved here.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundBooking(null)}>
              Close
            </Button>
            <Button
              onClick={() => {
                void qc.invalidateQueries({ queryKey: ["bookings"] });
                setRefundBooking(null);
              }}
            >
              Mark Resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
