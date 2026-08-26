"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { CalendarClock, X, Phone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CancelBookingModal } from "@/components/pos/cancel-booking-modal";
import type { Booking, Order, OrderItem } from "@/lib/supabase/types";

interface UpcomingDrawerProps {
  locationId: string;
}

type BookingRow = Booking & {
  order: Pick<Order, "customer_name" | "customer_phone" | "advance_paid" | "type">;
  order_item: Pick<OrderItem, "table_id" | "status"> & { table?: { name?: string } } | null;
};

// Outer gate — modal-pattern. Until the drawer is opened, this renders null
// and pays zero subscription cost. Inner only mounts when actually shown.
export function UpcomingDrawer({ locationId }: UpcomingDrawerProps) {
  const open = usePOSStore((s) => s.upcomingDrawerOpen);
  if (!open) return null;
  return <UpcomingDrawerInner locationId={locationId} />;
}

function UpcomingDrawerInner({ locationId }: UpcomingDrawerProps) {
  const qc           = useQueryClient();
  const setOpen      = usePOSStore((s) => s.setUpcomingDrawerOpen);
  const tables       = usePOSStore((s) => s.tables);
  const now          = usePOSStore((s) => s.now);
  const setSelected  = usePOSStore((s) => s.setSelectedTableId);
  const [cancellingBooking, setCancellingBooking] = useState<BookingRow | null>(null);

  // Reuses the same query key as pos-screen's bookings query so the data is
  // shared from cache — no extra request, no extra realtime sub.
  const { data: bookings = [] } = useQuery<BookingRow[]>({
    queryKey: ["pos-bookings", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/pos/bookings?locationId=${locationId}`);
      const body = await res.json() as { success: boolean; data: BookingRow[] };
      return body.success ? body.data : [];
    },
    staleTime: 30 * 1000,
  });

  // Dedup by (table, scheduled_start), keep only scheduled (not yet checked
  // in), sort ascending.
  const seen = new Set<string>();
  const upcoming = bookings
    .filter((b) => {
      const oi = b.order_item;
      if (oi?.status !== "scheduled") return false;
      const key = `${oi.table_id}_${b.scheduled_start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) =>
        new Date(a.scheduled_start).getTime() -
        new Date(b.scheduled_start).getTime()
    );

  const nowMs = now.getTime();
  const THIRTY_MINS = 30 * 60 * 1000;

  const soon = upcoming.filter((b) => {
    const diff = new Date(b.scheduled_start).getTime() - nowMs;
    return diff >= 0 && diff <= THIRTY_MINS;
  });

  const later = upcoming.filter((b) => {
    const diff = new Date(b.scheduled_start).getTime() - nowMs;
    return diff > THIRTY_MINS;
  });

  function minsFromNow(iso: string) {
    const diff = new Date(iso).getTime() - nowMs;
    if (diff < 0) return "now";
    const mins = Math.round(diff / 60000);
    if (mins === 0) return "now";
    if (mins < 60) return `in ${mins}m`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem === 0 ? `in ${hrs}h` : `in ${hrs}h ${rem}m`;
  }

  function fmtTime(iso: string) {
    const d = new Date(iso);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "pm" : "am";
    const hour = h % 12 || 12;
    return `${hour}${m > 0 ? `:${String(m).padStart(2, "0")}` : ""}${ampm}`;
  }

  function jumpToTable(tableId: string) {
    setSelected(tableId);
    setOpen(false);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-[420px] bg-[#f8f9fb] dark:bg-[#111]
          border-l border-gray-200 dark:border-[#222] shadow-2xl flex flex-col"
        style={{
          animation: "slideInRight 180ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-[#222] bg-white dark:bg-[#141414]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#D4541A]/10 text-[#D4541A]">
              <CalendarClock className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white leading-none">
                Upcoming today
              </h2>
              <p className="text-xs text-gray-400 mt-1">
                {upcoming.length} {upcoming.length === 1 ? "booking" : "bookings"} scheduled
              </p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {upcoming.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-6">
              {soon.length > 0 && (
                <Section title="Next 30 minutes" accent="#f59e0b" count={soon.length}>
                  {soon.map((b) => (
                    <Row key={b.id} booking={b} tables={tables} fmtTime={fmtTime} minsFromNow={minsFromNow} onJump={jumpToTable} onCancel={(b) => setCancellingBooking(b)} urgent />
                  ))}
                </Section>
              )}
              {later.length > 0 && (
                <Section title="Later today" accent="#9ca3af" count={later.length}>
                  {later.map((b) => (
                    <Row key={b.id} booking={b} tables={tables} fmtTime={fmtTime} minsFromNow={minsFromNow} onJump={jumpToTable} onCancel={(b) => setCancellingBooking(b)} />
                  ))}
                </Section>
              )}
            </div>
          )}
        </div>
      </div>

      {cancellingBooking && (
        <CancelBookingModal
          booking={{
            ...cancellingBooking,
            order_item: {
              table: tables.find((t) => t.id === cancellingBooking.order_item?.table_id) || null,
            },
          }}
          onClose={() => setCancellingBooking(null)}
          onSuccess={() => {
            setCancellingBooking(null);
            qc.invalidateQueries({ queryKey: ["pos-bookings"] });
            qc.invalidateQueries({ queryKey: ["owner-bookings"] });
            qc.invalidateQueries({ queryKey: ["tables"] });
            qc.invalidateQueries({ queryKey: ["manual-table-slots"] });
          }}
        />
      )}

      <style jsx>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}

function Section({
  title, accent, count, children,
}: {
  title: string;
  accent: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-1 h-3 rounded-full" style={{ background: accent }} />
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-600 dark:text-[#aaa]">
          {title}
        </h3>
        <span className="text-[10px] font-bold tabular-nums text-gray-400">·  {count}</span>
      </div>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

function Row({
  booking, tables, fmtTime, minsFromNow, onJump, onCancel, urgent,
}: {
  booking: BookingRow;
  tables: ReturnType<typeof usePOSStore.getState>["tables"];
  fmtTime: (iso: string) => string;
  minsFromNow: (iso: string) => string;
  onJump: (tableId: string) => void;
  onCancel: (booking: BookingRow) => void;
  urgent?: boolean;
}) {
  const oi = booking.order_item;
  const table = tables.find((t) => t.id === oi?.table_id);
  const customer = booking.order?.customer_name ?? "—";
  const phone = booking.order?.customer_phone;
  const tableId = oi?.table_id ?? null;

  return (
    <li
      className="flex items-stretch gap-2 p-3 rounded-xl transition-colors
        bg-white dark:bg-[#161616] border hover:bg-gray-50 dark:hover:bg-[#1c1c1c]"
      style={{ borderColor: urgent ? "rgba(245,158,11,0.35)" : "rgba(0,0,0,0.06)" }}
    >
      <button
        onClick={() => tableId && onJump(tableId)}
        disabled={!tableId}
        className="flex items-center gap-3 flex-1 min-w-0 text-left disabled:opacity-40"
      >
        {/* Time block — full slot range */}
        <div className="shrink-0 w-[84px]">
          <p className="font-mono text-base font-black tabular-nums text-gray-900 dark:text-white leading-tight">
            {fmtTime(booking.scheduled_start)}
          </p>
          <p className="font-mono text-sm font-extrabold tabular-nums text-gray-500 dark:text-[#888] leading-tight mt-0.5">
            → {fmtTime(booking.scheduled_end)}
          </p>
          <p
            className="text-xs font-black mt-1 tabular-nums"
            style={{ color: urgent ? "#f59e0b" : "#9ca3af" }}
          >
            {minsFromNow(booking.scheduled_start)}
          </p>
        </div>

        {/* Customer + table */}
        <div className="min-w-0 flex-1">
          <p className="font-black text-base text-gray-900 dark:text-white truncate">
            {customer}
          </p>
          {table && (
            <span
              className="inline-block mt-1 text-xs font-black px-2.5 py-0.5 rounded-md uppercase tracking-wide"
              style={{ background: "rgba(212,84,26,0.1)", color: "#D4541A" }}
            >
              {table.name}
            </span>
          )}
        </div>
      </button>

      {/* Click-to-copy phone */}
      {phone ? (
        <button
          onClick={() => {
            navigator.clipboard.writeText(phone).then(
              () => toast.success(`Copied ${phone}`),
              () => toast.error("Copy failed"),
            );
          }}
          className="shrink-0 self-center flex items-center gap-1.5 px-3 py-2.5 rounded-lg
            bg-gray-100 dark:bg-[#1f1f1f] hover:bg-[#f59e0b]/15 dark:hover:bg-[#f59e0b]/15 transition-colors
            text-gray-700 dark:text-[#ddd] hover:text-[#f59e0b] dark:hover:text-[#f59e0b] border border-gray-200 dark:border-[#333]"
          title="Click to copy number"
        >
          <Phone className="h-4 w-4 shrink-0" />
          <span className="text-sm font-mono font-black tabular-nums leading-none whitespace-nowrap">
            {phone}
          </span>
        </button>
      ) : null}

      {/* Cancel button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onCancel(booking);
        }}
        className="shrink-0 self-center flex items-center justify-center p-2.5 rounded-lg
          bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400
          border border-red-200 dark:border-red-900/50 transition-colors"
        title="Cancel this booking"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="py-16 text-center space-y-2">
      <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center bg-gray-100 dark:bg-[#1a1a1a]">
        <CalendarClock className="h-5 w-5 text-gray-300 dark:text-[#444]" />
      </div>
      <p className="text-sm font-semibold text-gray-500 dark:text-[#888]">All clear</p>
      <p className="text-xs text-gray-400 dark:text-[#555]">No upcoming bookings for today</p>
    </div>
  );
}
