"use client";

import { useState, useMemo, memo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { calculateBill } from "@/lib/billing/engine";
import { formatSignedCountdown, formatCurrency } from "@/lib/utils";
import { CalendarClock, Phone } from "lucide-react";
import { toast } from "sonner";
import type { POSOrder, TableWithStatus } from "@/store/pos";
import type { Order, OrderItem, Booking } from "@/lib/supabase/types";

const BOOKED_THRESHOLD_MINS = 30;

const typeIcon: Record<string, string> = {
  snooker:  "🎱",
  pool:     "🎱",
  ps5:      "🎮",
  foosball: "⚽",
};

function fmtName(name: string) {
  return name.replace(/\bps(\d)\b/gi, (_, n: string) => `PS${n}`);
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

// ── Idle card ─────────────────────────────────────────────────────────────────

function IdleCardImpl({ table, isSelected, onClick, upcomingBooking }: {
  table: TableWithStatus;
  isSelected: boolean;
  onClick: () => void;
  upcomingBooking?: TableWithStatus["upcomingBooking"];
}) {
  const accentTop = upcomingBooking ? "#f59e0b" : "#2a2a2a";
  return (
    <div
      onClick={onClick}
      className={`rounded-xl flex flex-col min-h-[180px] bg-white dark:bg-[#111] overflow-hidden cursor-pointer transition-all select-none
        ${isSelected ? "ring-2 ring-[#D4541A] ring-offset-1 shadow-md" : "shadow-sm hover:shadow-md"}`}
      style={{ border: isSelected ? undefined : "1px solid rgba(255,255,255,0.07)" }}
    >
      <div style={{ height: 4, background: accentTop, flexShrink: 0 }} />
      <div className="flex flex-col flex-1 p-4">
        <div className="flex items-start justify-between mb-3">
          <span className="text-3xl leading-none">{typeIcon[table.type] ?? "🎱"}</span>
          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-gray-800 dark:bg-[#2a2a2a] text-white uppercase tracking-wide">
            Idle
          </span>
        </div>
        <p className="font-bold text-gray-900 dark:text-white text-base leading-tight mb-1">
          {fmtName(table.name)}
        </p>
        <p className="text-sm font-semibold text-gray-600 dark:text-[#bbb] flex-1">
          {formatCurrency(table.hourly_rate)}/hr
        </p>
        {upcomingBooking ? (
          <div className="mt-3 flex items-center justify-between gap-1">
            <span
              className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full truncate"
              style={{ background: "rgba(245,158,11,0.18)", color: "#f59e0b" }}
            >
              Next {fmtTime(upcomingBooking.scheduled_start)} → {fmtTime(upcomingBooking.scheduled_end)}
            </span>
            <span className="text-xs font-semibold text-gray-500 dark:text-[#888] shrink-0">Tap →</span>
          </div>
        ) : (
          <p className="text-xs font-semibold mt-3 text-right" style={{ color: "#D4541A" }}>
            Tap to start →
          </p>
        )}
      </div>
    </div>
  );
}

// Card memoization rationale:
//   buildTableStatus() in pos-screen.tsx rebuilds the entire TableWithStatus[]
//   on every realtime event. Without memo, all N cards re-render even though
//   typically only one table changed. The custom comparators below compare the
//   handful of fields each card actually displays. `onClick` is intentionally
//   excluded (it's a fresh arrow function every render but semantically stable).
const IdleCard = memo(IdleCardImpl, (a, b) =>
  a.isSelected === b.isSelected &&
  a.table.id === b.table.id &&
  a.table.image_url === b.table.image_url &&
  a.table.name === b.table.name &&
  a.table.type === b.table.type &&
  a.table.hourly_rate === b.table.hourly_rate &&
  a.upcomingBooking?.id === b.upcomingBooking?.id &&
  a.upcomingBooking?.scheduled_start === b.upcomingBooking?.scheduled_start
);

// ── Running card ──────────────────────────────────────────────────────────────

function RunningCardImpl({ table, item, order, locationId, isSelected, onClick }: {
  table: TableWithStatus;
  item: OrderItem;
  order: POSOrder | undefined;
  locationId: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  const now            = usePOSStore((s) => s.now);
  const patchOrderItem = usePOSStore((s) => s.patchOrderItem);
  const qc             = useQueryClient();
  const [extending, setExtending] = useState<number | null>(null);

  const liveBill = calculateBill([item], [], now).subtotal;
  const startedAt = item.actual_start
    ? new Date(item.actual_start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : "";

  let countdown        = "";
  let isFiveMinWarning = false;
  let isOvertime       = false;
  let progressPct      = 0;

  if (item.expected_end) {
    const exp    = new Date(item.expected_end);
    const diffMs = exp.getTime() - now.getTime();
    const signed = formatSignedCountdown(exp, now);
    countdown    = signed.text;
    isOvertime   = signed.isOvertime;
    isFiveMinWarning = diffMs > 0 && diffMs < 5 * 60 * 1000;
    if (item.actual_start && diffMs > 0) {
      progressPct = Math.min(100, Math.max(0,
        (now.getTime() - new Date(item.actual_start).getTime()) /
        (exp.getTime()  - new Date(item.actual_start).getTime()) * 100
      ));
    }
  }

  // Mins of usable gap between current session end and next booking
  const gapToNextMins = (() => {
    if (!table.upcomingBooking || !item.expected_end) return Infinity;
    const ms = new Date(table.upcomingBooking.scheduled_start).getTime() - new Date(item.expected_end).getTime();
    return Math.max(0, Math.floor(ms / 60000));
  })();
  const canExtend15 = gapToNextMins >= 15;
  const canExtend30 = gapToNextMins >= 30;
  const accentColor    = isOvertime ? "#ef4444" : isFiveMinWarning ? "#f59e0b" : "#10b981";
  const bgClass        = isOvertime
    ? "bg-red-50 dark:bg-[rgba(239,68,68,0.08)]"
    : isFiveMinWarning
    ? "bg-amber-50 dark:bg-[rgba(245,158,11,0.07)]"
    : "bg-emerald-50 dark:bg-[rgba(16,185,129,0.06)]";

  const setStopConfirmItem = usePOSStore.getState().setStopConfirmItem;
  function stopSession(e: React.MouseEvent) {
    e.stopPropagation();
    setStopConfirmItem(item);
  }

  async function quickExtend(e: React.MouseEvent, mins: number) {
    e.stopPropagation();
    setExtending(mins);
    const prevEnd = item.expected_end;
    const newEnd  = new Date(new Date(prevEnd ?? now).getTime() + mins * 60 * 1000).toISOString();
    patchOrderItem(item.id, { expected_end: newEnd });
    const res = await fetch("/api/sessions/extend", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ order_item_id: item.id, extend_mins: mins }),
    });
    if (!res.ok) {
      patchOrderItem(item.id, { expected_end: prevEnd });
      toast.error("Failed to extend");
    } else {
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    }
    setExtending(null);
  }

  return (
    <div
      onClick={onClick}
      className={`rounded-xl flex flex-col min-h-[220px] ${bgClass} overflow-hidden cursor-pointer transition-all select-none
        ${isSelected ? "ring-2 ring-[#D4541A] ring-offset-1 shadow-md" : "shadow-sm hover:shadow-md"}`}
      style={{ border: isSelected ? undefined : `1px solid ${accentColor}22` }}
    >
      <div style={{ height: 4, background: accentColor, flexShrink: 0 }} />
      <div className="flex flex-col flex-1 p-4 gap-2">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-base">{typeIcon[table.type] ?? "🎱"}</span>
            <span className="text-sm font-bold text-gray-800 dark:text-[#ddd] truncate">
              {fmtName(table.name)}
            </span>
          </div>
          <span
            className={`text-[10px] font-extrabold px-2 py-0.5 rounded text-white shrink-0 ml-1 uppercase tracking-wide ${
              isOvertime || isFiveMinWarning ? "animate-pulse" : ""
            }`}
            style={{ background: accentColor }}
          >
            {isOvertime ? "Over time" : isFiveMinWarning ? "Ending" : "Live"}
          </span>
        </div>

        {/* Customer + live bill */}
        <div className="flex items-baseline justify-between">
          <p className="font-bold text-gray-900 dark:text-white text-base leading-tight truncate flex-1 mr-2">
            {order?.customer_name ?? "—"}
          </p>
          <span className="font-bold text-lg tabular-nums shrink-0" style={{ color: "#D4541A" }}>
            {formatCurrency(liveBill)}
          </span>
        </div>

        {/* People / controller count badge (only when tier pricing applied) */}
        {item.num_people != null && (
          <span
            className="inline-flex w-fit items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
            style={{ background: "rgba(212,84,26,0.12)", color: "#D4541A" }}
          >
            {item.num_people} {table.type === "ps5" ? "ctrl" : "ppl"}
          </span>
        )}

        {/* Progress bar */}
        <div
          className="h-1.5 rounded-full overflow-hidden"
          style={{ background: isOvertime ? "rgba(239,68,68,0.18)" : "rgba(0,0,0,0.07)" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width:      isOvertime ? "100%" : `${progressPct}%`,
              background: isOvertime ? "#ef4444" : progressPct > 90 ? "#f59e0b" : "#10b981",
              transition: "width 1s linear",
            }}
          />
        </div>

        {/* Start time + countdown / overtime */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono font-semibold tabular-nums text-gray-700 dark:text-[#bbb]">
            {startedAt}
          </span>
          <span
            className="text-sm font-mono font-bold tabular-nums"
            style={{ color: isOvertime ? "#ef4444" : isFiveMinWarning ? "#f59e0b" : "#10b981" }}
          >
            {countdown}{isOvertime ? " over" : " left"}
          </span>
        </div>

        {/* Upcoming booking — name + slot + click-to-copy phone */}
        {table.upcomingBooking && (
          <div className="flex flex-wrap items-center gap-1">
            <span
              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "rgba(245,158,11,0.15)", color: "#d97706" }}
            >
              → {table.upcomingBooking.order?.customer_name ?? "Booking"} · {fmtTime(table.upcomingBooking.scheduled_start)}
            </span>
            {table.upcomingBooking.order?.customer_phone && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const ph = table.upcomingBooking!.order!.customer_phone!;
                  navigator.clipboard.writeText(ph).then(
                    () => toast.success(`Copied ${ph}`),
                    () => toast.error("Copy failed"),
                  );
                }}
                className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded
                  bg-gray-100 dark:bg-[#1f1f1f] hover:bg-[#f59e0b]/15 text-gray-700 dark:text-[#ddd] hover:text-[#f59e0b] transition"
                title="Click to copy number"
              >
                <Phone className="h-2.5 w-2.5" />
                {table.upcomingBooking.order.customer_phone}
              </button>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-1.5 mt-auto pt-1" onClick={(e) => e.stopPropagation()}>
          {canExtend15 && (
            <button
              onClick={(e) => quickExtend(e, 15)}
              disabled={!!extending}
              className="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 disabled:opacity-40"
              style={{
                background: "rgba(16,185,129,0.1)",
                color:      "#10b981",
                border:     "1px solid rgba(16,185,129,0.2)",
              }}
            >
              {extending === 15 ? "…" : "+15m"}
            </button>
          )}
          {canExtend30 && (
            <button
              onClick={(e) => quickExtend(e, 30)}
              disabled={!!extending}
              className="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 disabled:opacity-40"
              style={{
                background: "rgba(16,185,129,0.1)",
                color:      "#10b981",
                border:     "1px solid rgba(16,185,129,0.2)",
              }}
            >
              {extending === 30 ? "…" : "+30m"}
            </button>
          )}
          <button
            onClick={stopSession}
            disabled={!!extending}
            className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-40 hover:brightness-110"
            style={{ background: "#ef4444" }}
          >
            ■ Stop
          </button>
        </div>
      </div>
    </div>
  );
}

const RunningCard = memo(RunningCardImpl, (a, b) =>
  a.isSelected === b.isSelected &&
  a.locationId === b.locationId &&
  a.table.id === b.table.id &&
  a.item.id === b.item.id &&
  a.item.status === b.item.status &&
  a.item.expected_end === b.item.expected_end &&
  a.item.actual_start === b.item.actual_start &&
  a.item.num_people === b.item.num_people &&
  a.item.rate_per_hour === b.item.rate_per_hour &&
  a.order?.customer_name === b.order?.customer_name &&
  // Live bill depends on extras length + total; cheap to compare counts/sum
  a.order?.extras?.length === b.order?.extras?.length &&
  a.table.upcomingBooking?.scheduled_start === b.table.upcomingBooking?.scheduled_start
);

// ── Booked card ───────────────────────────────────────────────────────────────

function BookedCardImpl({ table, locationId, isSelected, onClick }: {
  table: TableWithStatus;
  locationId: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  const now = usePOSStore((s) => s.now);
  const qc  = useQueryClient();
  const booking  = table.upcomingBooking!;
  const [loadingCheckin, setLoadingCheckin] = useState(false);
  const [loadingNoshow,  setLoadingNoshow]  = useState(false);
  const [confirmNoshow,  setConfirmNoshow]  = useState(false);

  const start      = new Date(booking.scheduled_start);
  const diffMs     = start.getTime() - now.getTime();
  const minsAway   = Math.max(0, Math.ceil(diffMs / 60000));
  const isImminent = diffMs > 0 && diffMs < 10 * 60 * 1000;
  const isOverdue  = diffMs <= 0;

  async function checkIn(e: React.MouseEvent) {
    e.stopPropagation();
    setLoadingCheckin(true);
    const res = await fetch(`/api/bookings/${booking.id}/checkin`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      toast.error(body.error ?? "Check-in failed");
    } else {
      qc.invalidateQueries({ queryKey: ["pos-orders",   locationId] });
      qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
    }
    setLoadingCheckin(false);
  }

  async function markNoShow(e: React.MouseEvent) {
    e.stopPropagation();
    setLoadingNoshow(true);
    const res = await fetch(`/api/bookings/${booking.id}/noshow`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      toast.error(body.error ?? "Failed to mark no-show");
    } else {
      qc.invalidateQueries({ queryKey: ["pos-orders",   locationId] });
      qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
    }
    setLoadingNoshow(false);
    setConfirmNoshow(false);
  }

  return (
    <div
      onClick={onClick}
      className={`rounded-xl flex flex-col min-h-[200px] bg-amber-50 dark:bg-[rgba(245,158,11,0.05)] overflow-hidden cursor-pointer transition-all select-none
        ${isSelected ? "ring-2 ring-[#D4541A] ring-offset-1 shadow-md" : "shadow-sm hover:shadow-md"}`}
      style={{ border: isSelected ? undefined : "1px solid rgba(245,158,11,0.22)" }}
    >
      <div style={{ height: 4, background: "#f59e0b", flexShrink: 0 }} />
      <div className="flex flex-col flex-1 p-4 gap-2">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-base">{typeIcon[table.type] ?? "🎱"}</span>
            <span className="text-sm font-bold text-gray-800 dark:text-[#ddd] truncate">
              {fmtName(table.name)}
            </span>
          </div>
          <span
            className="text-[10px] font-extrabold px-2 py-0.5 rounded text-white shrink-0 ml-1 uppercase tracking-wide"
            style={{ background: "#f59e0b" }}
          >
            Booked
          </span>
        </div>

        {/* Customer */}
        <p className="font-bold text-gray-900 dark:text-white text-base leading-tight truncate">
          {booking.order?.customer_name}
        </p>
        {booking.order?.customer_phone && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const ph = booking.order!.customer_phone!;
              navigator.clipboard.writeText(ph).then(
                () => toast.success(`Copied ${ph}`),
                () => toast.error("Copy failed"),
              );
            }}
            className="inline-flex items-center gap-1 -mt-1 self-start text-[11px] font-mono font-semibold text-gray-500 dark:text-[#aaa] hover:text-[#f59e0b] dark:hover:text-[#f59e0b] truncate"
            title="Click to copy number"
          >
            <Phone className="h-3 w-3" />
            {booking.order.customer_phone}
          </button>
        )}

        {/* Time + countdown */}
        <div>
          <p className="font-mono text-sm font-bold tabular-nums" style={{ color: "#f59e0b" }}>
            {fmtTime(booking.scheduled_start)} → {fmtTime(booking.scheduled_end)}
          </p>
          <p
            className="text-xs font-semibold mt-0.5"
            style={{ color: isOverdue ? "#ef4444" : isImminent ? "#f59e0b" : "#9ca3af" }}
          >
            {isOverdue
              ? `${Math.abs(Math.ceil(diffMs / 60000))}m overdue`
              : isImminent
              ? "Arriving now!"
              : `in ${minsAway}m`}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-1.5 mt-auto pt-1" onClick={(e) => e.stopPropagation()}>
          {!confirmNoshow ? (
            <>
              <button
                onClick={checkIn}
                disabled={loadingCheckin || loadingNoshow}
                className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-40"
                style={{ background: "#f59e0b" }}
              >
                {loadingCheckin ? "…" : "Check In"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmNoshow(true); }}
                disabled={loadingCheckin || loadingNoshow}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 disabled:opacity-40
                  bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]
                  text-gray-400 dark:text-[#555] hover:text-red-400 hover:border-red-200 dark:hover:border-red-900"
              >
                No-show
              </button>
            </>
          ) : (
            <>
              <button
                onClick={markNoShow}
                disabled={loadingNoshow}
                className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-40"
                style={{ background: "#ef4444" }}
              >
                {loadingNoshow ? "…" : "Confirm"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmNoshow(false); }}
                disabled={loadingNoshow}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all
                  bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]
                  text-gray-400 dark:text-[#555] hover:text-gray-700 dark:hover:text-white"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const BookedCard = memo(BookedCardImpl, (a, b) =>
  a.isSelected === b.isSelected &&
  a.locationId === b.locationId &&
  a.table.id === b.table.id &&
  a.table.upcomingBooking?.id === b.table.upcomingBooking?.id &&
  a.table.upcomingBooking?.scheduled_start === b.table.upcomingBooking?.scheduled_start &&
  a.table.upcomingBooking?.order?.customer_name === b.table.upcomingBooking?.order?.customer_name
);

// ── Bill-ready card ───────────────────────────────────────────────────────────

function BillReadyCardImpl({ table, order, isSelected, onClick }: {
  table: TableWithStatus;
  order: POSOrder;
  isSelected: boolean;
  onClick: () => void;
}) {
  const setFinalizeOrderId = usePOSStore((s) => s.setFinalizeOrderId);

  // Bill is slot-based and fixed once session ends — `now` has no effect on finished items
  const billDue = calculateBill(
    order.items.filter((i) => !i.is_deleted),
    order.extras.filter((e) => !e.is_deleted),
    new Date(), null, order.advance_paid ?? 0
  ).totalDue;

  return (
    <div
      onClick={onClick}
      className={`rounded-xl flex flex-col min-h-[200px] bg-orange-50 dark:bg-[rgba(212,84,26,0.07)] overflow-hidden cursor-pointer transition-all select-none
        ${isSelected ? "ring-2 ring-[#D4541A] ring-offset-1 shadow-md" : "shadow-sm hover:shadow-md"}`}
      style={{ border: isSelected ? undefined : "1px solid rgba(212,84,26,0.22)" }}
    >
      <div style={{ height: 4, background: "#D4541A", flexShrink: 0 }} />
      <div className="flex flex-col flex-1 p-4 gap-2">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-base">{typeIcon[table.type] ?? "🎱"}</span>
            <span className="text-sm font-bold text-gray-800 dark:text-[#ddd] truncate">
              {fmtName(table.name)}
            </span>
          </div>
          <span
            className="text-[10px] font-extrabold px-2 py-0.5 rounded text-white shrink-0 ml-1 uppercase tracking-wide"
            style={{ background: "#D4541A" }}
          >
            Bill Ready
          </span>
        </div>

        {/* Customer */}
        <p className="font-bold text-gray-900 dark:text-white text-base leading-tight">
          {order.customer_name}
        </p>
        <p className="text-xs font-semibold text-gray-600 dark:text-[#aaa]">Session ended</p>

        {/* Amount */}
        <p
          className="font-extrabold tabular-nums flex-1"
          style={{ fontSize: 28, color: "#D4541A", lineHeight: 1.1 }}
        >
          {formatCurrency(billDue)}
        </p>

        {/* Quick collect — goes straight to finalize modal */}
        <button
          onClick={(e) => { e.stopPropagation(); setFinalizeOrderId(order.id); }}
          className="w-full py-2 rounded-lg text-sm font-bold text-white transition-all active:scale-95 hover:brightness-110 mt-auto"
          style={{ background: "#D4541A" }}
        >
          Collect Bill
        </button>
      </div>
    </div>
  );
}

const BillReadyCard = memo(BillReadyCardImpl, (a, b) =>
  a.isSelected === b.isSelected &&
  a.table.id === b.table.id &&
  a.order.id === b.order.id &&
  a.order.customer_name === b.order.customer_name &&
  a.order.items.length === b.order.items.length &&
  a.order.extras.length === b.order.extras.length
);

// ── Upcoming strip ────────────────────────────────────────────────────────────

type BookingRow = Booking & {
  order: Pick<Order, "customer_name" | "customer_phone" | "advance_paid">;
  order_item: Pick<OrderItem, "table_id" | "status"> | null;
};

function UpcomingStrip({ locationId }: { locationId: string }) {
  const now    = usePOSStore((s) => s.now);
  const tables = usePOSStore((s) => s.tables);

  const { data: bookings = [] } = useQuery<BookingRow[]>({
    queryKey: ["pos-bookings", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/pos/bookings?locationId=${locationId}`);
      const body = await res.json() as { success: boolean; data: BookingRow[] };
      return body.success ? body.data : [];
    },
    staleTime: 30000,
  });

  const seen     = new Set<string>();
  const upcoming = bookings
    .filter((b) => {
      const oi = b.order_item as Pick<OrderItem, "table_id" | "status"> | null;
      if (oi?.status !== "scheduled") return false;
      const key = `${oi.table_id}:${b.scheduled_start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime())
    .slice(0, 8);

  if (upcoming.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#111]">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <CalendarClock className="h-4 w-4 text-gray-500 dark:text-[#aaa]" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-gray-600 dark:text-[#bbb]">
          Upcoming Today
        </span>
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: "rgba(212,84,26,0.1)", color: "#D4541A" }}
        >
          {upcoming.length}
        </span>
      </div>

      <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
        {upcoming.map((booking) => {
          const oi         = booking.order_item as Pick<OrderItem, "table_id" | "status"> | null;
          const table      = tables.find((t) => t.id === oi?.table_id);
          const start      = new Date(booking.scheduled_start);
          const diffMs     = start.getTime() - now.getTime();
          const minsAway   = Math.max(0, Math.ceil(diffMs / 60000));
          const isOverdue  = diffMs <= 0;
          const isImminent = diffMs > 0 && diffMs < 10 * 60 * 1000;

          return (
            <div
              key={booking.id}
              className="shrink-0 rounded-xl border px-3 py-2.5 min-w-[150px] bg-gray-50 dark:bg-[#0d0d0d]"
              style={{
                borderColor: isOverdue
                  ? "rgba(239,68,68,0.25)"
                  : isImminent
                  ? "rgba(245,158,11,0.25)"
                  : "rgba(0,0,0,0.06)",
              }}
            >
              {table && (
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide mb-1 inline-block"
                  style={{ background: "rgba(212,84,26,0.08)", color: "#D4541A" }}
                >
                  {table.name}
                </span>
              )}
              <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                {booking.order?.customer_name}
              </p>
              <p className="font-mono text-xs font-bold tabular-nums mt-0.5" style={{ color: "#f59e0b" }}>
                {fmtTime(booking.scheduled_start)}
              </p>
              <p
                className="text-[10px] font-semibold mt-0.5"
                style={{ color: isOverdue ? "#ef4444" : isImminent ? "#f59e0b" : "#9ca3af" }}
              >
                {isOverdue
                  ? `${Math.abs(Math.ceil(diffMs / 60000))}m late`
                  : isImminent
                  ? "Arriving!"
                  : `in ${minsAway}m`}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface TableGridProps {
  locationId: string;
}

function TableGridInner({ locationId }: TableGridProps) {
  const tables             = usePOSStore((s) => s.tables);
  const openOrders         = usePOSStore((s) => s.openOrders);
  const selectedTableId    = usePOSStore((s) => s.selectedTableId);
  const setSelectedTableId = usePOSStore((s) => s.setSelectedTableId);

  const billReadyMap = useMemo(() => {
    const map: Record<string, POSOrder> = {};
    for (const order of openOrders) {
      const hasRunning  = order.items.some((i) => !i.is_deleted && i.status === "running");
      const hasFinished = order.items.some((i) => !i.is_deleted && i.status === "finished");
      if (!hasRunning && hasFinished) {
        for (const item of order.items) {
          if (!item.is_deleted && item.status === "finished") {
            map[item.table_id] = order;
          }
        }
      }
    }
    return map;
  }, [openOrders]);

  if (tables.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-base font-medium text-gray-500 dark:text-[#aaa]">
        No tables configured
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {tables.map((table) => {
            const item              = table.activeOrderItem;
            const isRunning         = !!item && item.status === "running";
            const billReadyOrder    = billReadyMap[table.id];
            const isBillReady       = !!billReadyOrder && !isRunning;
            const minsUntilBooking  = table.upcomingBooking
              ? (new Date(table.upcomingBooking.scheduled_start).getTime() - Date.now()) / 60000
              : Infinity;
            const isBooked          = !isRunning && !isBillReady && !!table.upcomingBooking && minsUntilBooking <= BOOKED_THRESHOLD_MINS;
            const isIdleWithUpcoming = !isRunning && !isBillReady && !!table.upcomingBooking && minsUntilBooking > BOOKED_THRESHOLD_MINS;
            const isSelected        = selectedTableId === table.id;
            const toggle            = () => setSelectedTableId(isSelected ? null : table.id);

            if (isRunning && item) {
              const order = openOrders.find((o) => o.items.some((i) => i.id === item.id));
              return (
                <RunningCard
                  key={table.id}
                  table={table}
                  item={item}
                  order={order}
                  locationId={locationId}
                  isSelected={isSelected}
                  onClick={toggle}
                />
              );
            }

            if (isBillReady && billReadyOrder) {
              return (
                <BillReadyCard
                  key={table.id}
                  table={table}
                  order={billReadyOrder}
                  isSelected={isSelected}
                  onClick={toggle}
                />
              );
            }

            if (isBooked) {
              return (
                <BookedCard
                  key={table.id}
                  table={table}
                  locationId={locationId}
                  isSelected={isSelected}
                  onClick={toggle}
                />
              );
            }

            return (
              <IdleCard
                key={table.id}
                table={table}
                isSelected={isSelected}
                onClick={toggle}
                upcomingBooking={isIdleWithUpcoming ? table.upcomingBooking : undefined}
              />
            );
          })}
        </div>
      </div>

      <UpcomingStrip locationId={locationId} />
    </div>
  );
}

export const TableGrid = memo(TableGridInner);
