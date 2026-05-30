"use client";

import { useQuery } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { CalendarClock, X, Phone } from "lucide-react";
import { toast } from "sonner";
import type { Booking, Order, OrderItem } from "@/lib/supabase/types";

interface UpcomingDrawerProps {
  locationId: string;
}

type BookingRow = Booking & {
  order: Pick<Order, "customer_name" | "customer_phone">;
  order_item: Pick<OrderItem, "table_id" | "status"> | null;
};

// Outer gate — modal-pattern. Until the drawer is opened, this renders null
// and pays zero subscription cost. Inner only mounts when actually shown.
export function UpcomingDrawer({ locationId }: UpcomingDrawerProps) {
  const open = usePOSStore((s) => s.upcomingDrawerOpen);
  if (!open) return null;
  return <UpcomingDrawerInner locationId={locationId} />;
}

function UpcomingDrawerInner({ locationId }: UpcomingDrawerProps) {
  const setOpen      = usePOSStore((s) => s.setUpcomingDrawerOpen);
  const tables       = usePOSStore((s) => s.tables);
  const now          = usePOSStore((s) => s.now);
  const setSelected  = usePOSStore((s) => s.setSelectedTableId);

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
      const key = `${oi.table_id}:${b.scheduled_start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) =>
      new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime()
    );

  // Split into time bands
  const soon: BookingRow[] = [];   // <= 30 min
  const later: BookingRow[] = [];  // > 30 min
  for (const b of upcoming) {
    const minsAway = (new Date(b.scheduled_start).getTime() - now.getTime()) / 60000;
    if (minsAway <= 30) soon.push(b);
    else later.push(b);
  }

  function close() { setOpen(false); }

  function jumpToTable(tableId: string) {
    setSelected(tableId);
    close();
  }

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  const minsFromNow = (iso: string) => {
    const diff = (new Date(iso).getTime() - now.getTime()) / 60000;
    if (diff < 0)     return `${Math.abs(Math.ceil(diff))}m late`;
    if (diff < 1)     return "now";
    if (diff < 60)    return `in ${Math.ceil(diff)}m`;
    const hrs = diff / 60;
    if (hrs < 10)     return `in ${hrs.toFixed(1)}h`;
    return `in ${Math.round(hrs)}h`;
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={close}
      />
      {/* Drawer */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[420px] flex flex-col
          bg-white dark:bg-[#0e0e0e] border-l border-gray-200 dark:border-[#1f1f1f] shadow-2xl"
        style={{ animation: "slideInRight 250ms cubic-bezier(0.22, 1, 0.36, 1)" }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-4 border-b border-gray-200 dark:border-[#1f1f1f]">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "rgba(212,84,26,0.12)" }}
          >
            <CalendarClock className="h-4 w-4" style={{ color: "#D4541A" }} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-gray-900 dark:text-white text-base leading-tight">
              Upcoming today
            </h2>
            <p className="text-xs text-gray-500 dark:text-[#888] mt-0.5">
              {upcoming.length} total · {soon.length} within 30 min
            </p>
          </div>
          <button
            onClick={close}
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
                    <Row key={b.id} booking={b} tables={tables} fmtTime={fmtTime} minsFromNow={minsFromNow} onJump={jumpToTable} urgent />
                  ))}
                </Section>
              )}
              {later.length > 0 && (
                <Section title="Later today" accent="#9ca3af" count={later.length}>
                  {later.map((b) => (
                    <Row key={b.id} booking={b} tables={tables} fmtTime={fmtTime} minsFromNow={minsFromNow} onJump={jumpToTable} />
                  ))}
                </Section>
              )}
            </div>
          )}
        </div>
      </div>

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
  booking, tables, fmtTime, minsFromNow, onJump, urgent,
}: {
  booking: BookingRow;
  tables: ReturnType<typeof usePOSStore.getState>["tables"];
  fmtTime: (iso: string) => string;
  minsFromNow: (iso: string) => string;
  onJump: (tableId: string) => void;
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
        <div className="shrink-0 w-[68px]">
          <p className="font-mono text-sm font-bold tabular-nums text-gray-900 dark:text-white leading-tight">
            {fmtTime(booking.scheduled_start)}
          </p>
          <p className="font-mono text-[11px] tabular-nums text-gray-500 dark:text-[#888] leading-tight">
            → {fmtTime(booking.scheduled_end)}
          </p>
          <p
            className="text-[10px] font-bold mt-0.5 tabular-nums"
            style={{ color: urgent ? "#f59e0b" : "#9ca3af" }}
          >
            {minsFromNow(booking.scheduled_start)}
          </p>
        </div>

        {/* Customer + table */}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">
            {customer}
          </p>
          {table && (
            <span
              className="inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
              style={{ background: "rgba(212,84,26,0.1)", color: "#D4541A" }}
            >
              {table.name}
            </span>
          )}
        </div>
      </button>

      {/* Click-to-copy phone — staff is on PC, copies number to dial */}
      {phone ? (
        <button
          onClick={() => {
            navigator.clipboard.writeText(phone).then(
              () => toast.success(`Copied ${phone}`),
              () => toast.error("Copy failed"),
            );
          }}
          className="shrink-0 self-center flex items-center gap-1.5 px-3 py-2 rounded-lg
            bg-gray-100 dark:bg-[#1f1f1f] hover:bg-[#f59e0b]/15 dark:hover:bg-[#f59e0b]/15 transition-colors
            text-gray-700 dark:text-[#ddd] hover:text-[#f59e0b] dark:hover:text-[#f59e0b]"
          title="Click to copy number"
        >
          <Phone className="h-3.5 w-3.5" />
          <span className="text-[11px] font-mono font-semibold tabular-nums leading-none whitespace-nowrap">
            {phone}
          </span>
        </button>
      ) : null}
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
