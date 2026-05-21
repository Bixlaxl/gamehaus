"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import type { Booking, Order, OrderItem } from "@/lib/supabase/types";

interface UpcomingViewProps {
  locationId: string;
}

type BookingRow = Booking & {
  order: Pick<Order, "customer_name" | "customer_phone">;
  order_item: Pick<OrderItem, "table_id" | "status"> | null;
};

export function UpcomingView({ locationId }: UpcomingViewProps) {
  const tables = usePOSStore((s) => s.tables);
  const now    = usePOSStore((s) => s.now);
  const qc = useQueryClient();
  const [shifting, setShifting] = useState<string | null>(null);

  const { data: bookings = [] } = useQuery<BookingRow[]>({
    queryKey: ["pos-bookings", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/pos/bookings?locationId=${locationId}`);
      const body = await res.json() as { success: boolean; data: BookingRow[] };
      return body.success ? body.data : [];
    },
    staleTime: 30000,
  });

  const seen = new Set<string>();
  const upcoming = bookings
    .filter((b) => {
      const oi = b.order_item as Pick<OrderItem, "table_id" | "status"> | null;
      if (oi?.status !== "scheduled") return false;
      const key = `${oi.table_id}:${b.scheduled_start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime()
    );

  async function reschedule(bookingId: string, shiftMins: number) {
    setShifting(bookingId + shiftMins);
    const res = await fetch(`/api/bookings/${bookingId}/reschedule`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ shift_mins: shiftMins }),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      toast.error(body.error ?? "Failed to reschedule");
    } else {
      qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
    }
    setShifting(null);
  }

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="h-full overflow-y-auto">
      {/* Page header */}
      <div className="px-6 pt-5 pb-4 flex items-center gap-3">
        <CalendarClock className="h-4 w-4 text-gray-400 dark:text-[#555] shrink-0" />
        <h2 className="font-bold text-gray-900 dark:text-white text-base">Upcoming Bookings</h2>
        {upcoming.length > 0 && (
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: "rgba(212,84,26,0.1)", color: "#D4541A" }}
          >
            {upcoming.length}
          </span>
        )}
        <span className="text-xs text-gray-400 dark:text-[#555] ml-auto">
          {now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
        </span>
      </div>

      {upcoming.length === 0 ? (
        <div className="py-24 text-center space-y-2">
          <p className="text-sm font-medium text-gray-400 dark:text-[#555]">All clear</p>
          <p className="text-xs text-gray-300 dark:text-[#333]">No upcoming bookings for today</p>
        </div>
      ) : (
        <div className="px-5 pb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.map((booking) => {
            const oi    = booking.order_item as Pick<OrderItem, "table_id" | "status"> | null;
            const table = tables.find((t) => t.id === oi?.table_id);

            const start      = new Date(booking.scheduled_start);
            const diffMs     = start.getTime() - now.getTime();
            const minsAway   = Math.max(0, Math.ceil(diffMs / 60000));
            const isImminent = diffMs > 0 && diffMs < 5 * 60 * 1000;
            const isOverdue  = diffMs <= 0;

            return (
              <div
                key={booking.id}
                className={`rounded-2xl p-4 bg-white dark:bg-[#111] border shadow-sm ${
                  isOverdue
                    ? "border-red-200 dark:border-[rgba(239,68,68,0.25)]"
                    : isImminent
                    ? "border-amber-200 dark:border-[rgba(245,158,11,0.25)]"
                    : "border-gray-100 dark:border-[#1f1f1f]"
                }`}
              >
                {/* Table badge */}
                {table && (
                  <span
                    className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide mb-2"
                    style={{ background: "rgba(212,84,26,0.08)", color: "#D4541A" }}
                  >
                    {table.name}
                  </span>
                )}

                {/* Customer + timing */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-gray-900 dark:text-white leading-tight truncate">
                      {booking.order?.customer_name}
                    </p>
                    {booking.order?.customer_phone && (
                      <p className="text-xs text-gray-400 dark:text-[#666] mt-0.5">
                        {booking.order.customer_phone}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm font-bold tabular-nums" style={{ color: "#f59e0b" }}>
                      {fmtTime(booking.scheduled_start)}
                    </p>
                    <p className="text-xs font-mono tabular-nums text-gray-400 dark:text-[#555]">
                      → {fmtTime(booking.scheduled_end)}
                    </p>
                    <p
                      className="text-[10px] font-semibold mt-0.5"
                      style={{
                        color: isImminent ? "#f59e0b" : isOverdue ? "#ef4444" : "#9ca3af",
                      }}
                    >
                      {isImminent
                        ? "Arriving now!"
                        : isOverdue
                        ? `+${Math.abs(Math.ceil(diffMs / 60000))}m late`
                        : `in ${minsAway}m`}
                    </p>
                  </div>
                </div>

                {/* Shift buttons */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-wide text-gray-300 dark:text-[#444] mr-1">
                    Shift
                  </span>
                  {[15, 30, 60].map((mins) => (
                    <button
                      key={mins}
                      disabled={!!shifting}
                      onClick={() => reschedule(booking.id, mins)}
                      className="px-2.5 py-1 rounded-md text-xs font-semibold transition-all disabled:opacity-40
                        bg-gray-900 text-white hover:bg-gray-700
                        dark:bg-[#1A1A1A] dark:text-[#777] dark:border dark:border-[#2A2A2A] dark:hover:text-white dark:hover:border-[#444]"
                    >
                      {shifting === booking.id + mins ? "…" : `+${mins}m`}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
