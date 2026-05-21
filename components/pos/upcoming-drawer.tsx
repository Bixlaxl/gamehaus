"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { X, CalendarClock } from "lucide-react";
import type { Booking, Order, OrderItem } from "@/lib/supabase/types";

interface UpcomingDrawerProps {
  locationId: string;
}

type BookingRow = Booking & {
  order: Pick<Order, "customer_name" | "customer_phone">;
  order_item: Pick<OrderItem, "table_id" | "status"> | null;
};

export function UpcomingDrawer({ locationId }: UpcomingDrawerProps) {
  const upcomingOpen = usePOSStore((s) => s.upcomingOpen);
  if (!upcomingOpen) return null;
  return <UpcomingDrawerInner locationId={locationId} />;
}

function UpcomingDrawerInner({ locationId }: UpcomingDrawerProps) {
  const setUpcomingOpen = usePOSStore((s) => s.setUpcomingOpen);
  const tables          = usePOSStore((s) => s.tables);
  const now             = usePOSStore((s) => s.now);
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

  const upcoming = bookings
    .filter((b) => {
      const oi = b.order_item as Pick<OrderItem, "table_id" | "status"> | null;
      return oi?.status === "scheduled";
    })
    .sort((a, b) =>
      new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime()
    );

  async function reschedule(bookingId: string, shiftMins: number) {
    setShifting(bookingId + shiftMins);
    const res = await fetch(`/api/bookings/${bookingId}/reschedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shift_mins: shiftMins }),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      alert(body.error ?? "Failed to reschedule");
    } else {
      qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
    }
    setShifting(null);
  }

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="flex-1 bg-black/50 dark:bg-black/60" onClick={() => setUpcomingOpen(false)} />

      <div className="w-96 flex flex-col bg-white dark:bg-[#111] border-l border-gray-200 dark:border-[#1F1F1F]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-[#1F1F1F]">
          <div className="flex items-center gap-2.5">
            <CalendarClock className="h-4 w-4 text-gray-400 dark:text-[#555]" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-gray-900 dark:text-white text-base">Upcoming</h2>
                {upcoming.length > 0 && (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: "rgba(212,84,26,0.1)", color: "#D4541A" }}
                  >
                    {upcoming.length}
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5 text-gray-400 dark:text-[#555]">
                {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
              </p>
            </div>
          </div>
          <button
            onClick={() => setUpcomingOpen(false)}
            className="text-gray-400 dark:text-[#555] hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto">
          {upcoming.length === 0 ? (
            <div className="py-16 text-center space-y-1">
              <p className="text-sm font-medium text-gray-400 dark:text-[#555]">All clear</p>
              <p className="text-xs text-gray-300 dark:text-[#333]">No upcoming bookings for today</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-[#1A1A1A]">
              {upcoming.map((booking) => {
                const oi    = booking.order_item as Pick<OrderItem, "table_id" | "status"> | null;
                const table = tables.find((t) => t.id === oi?.table_id);

                const start      = new Date(booking.scheduled_start);
                const diffMs     = start.getTime() - now.getTime();
                const minsAway   = Math.max(0, Math.ceil(diffMs / 60000));
                const isImminent = diffMs > 0 && diffMs < 5 * 60 * 1000;
                const isOverdue  = diffMs <= 0;

                const accentColor = isImminent ? "#f59e0b" : isOverdue ? "#ef4444" : "#e5e7eb";
                const accentColorDark = isImminent ? "#f59e0b" : isOverdue ? "#ef4444" : "#1F1F1F";

                return (
                  <div
                    key={booking.id}
                    className="px-4 py-3.5 relative"
                  >
                    {/* Left accent bar */}
                    <div
                      className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full"
                      style={{ background: accentColor }}
                    />
                    <div
                      className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full dark:block hidden"
                      style={{ background: accentColorDark }}
                    />

                    {/* Top row: table tag + customer | time */}
                    <div className="flex items-start justify-between gap-3 pl-3">
                      <div className="min-w-0 flex-1">
                        {table && (
                          <span
                            className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide mb-1"
                            style={{ background: "rgba(212,84,26,0.08)", color: "#D4541A" }}
                          >
                            {table.name}
                          </span>
                        )}
                        <p className="font-semibold text-gray-900 dark:text-white text-sm leading-tight truncate">
                          {booking.order?.customer_name}
                        </p>
                        {booking.order?.customer_phone && (
                          <p className="text-xs text-gray-400 dark:text-[#666] mt-0.5 tabular-nums">
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
                          {isImminent ? "Arriving now!" : isOverdue ? `+${Math.abs(Math.ceil(diffMs / 60000))}m` : `in ${minsAway}m`}
                        </p>
                      </div>
                    </div>

                    {/* Shift buttons */}
                    <div className="flex items-center gap-1.5 mt-2.5 pl-3">
                      <span className="text-[9px] font-bold uppercase tracking-wide text-gray-300 dark:text-[#444] shrink-0 mr-0.5">
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
      </div>
    </div>
  );
}
