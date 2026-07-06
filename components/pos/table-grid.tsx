"use client";

import { useState, useMemo, memo } from "react";
import NextImage from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { useNowSampled } from "@/hooks/use-now-sampled";
import { calculateBill, computeFreeHoursDiscount } from "@/lib/billing/engine";
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

// Small inline thumbnail used on Running / Booked / Upcoming card headers.
// Falls back to the type emoji when no image is set so older tables still look
// fine — staff can re-upload later.
function TableThumb({ table, size = 28 }: { table: { image_url: string | null; name: string; type: string }; size?: number }) {
  if (!table.image_url) {
    return <span className="shrink-0" style={{ fontSize: `${size * 0.7}px`, lineHeight: 1 }}>{typeIcon[table.type] ?? "🎯"}</span>;
  }
  return (
    <NextImage
      src={table.image_url}
      alt={table.name}
      width={size}
      height={size}
      className="rounded shrink-0 object-cover"
      style={{ width: size, height: size }}
    />
  );
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
      className={`group rounded-xl flex flex-col min-h-[440px] overflow-hidden cursor-pointer select-none
        bg-white hover:bg-gray-50
        dark:bg-[#111] dark:hover:bg-[#1c1c1c]
        transition-colors duration-150 ease-out
        active:scale-[0.99]
        ${isSelected ? "ring-2 ring-[#D4541A] ring-offset-1 shadow-md" : "shadow-sm"}`}
      style={{ border: isSelected ? undefined : "1px solid rgba(255,255,255,0.07)" }}
    >
      <div style={{ height: 4, background: accentTop, flexShrink: 0 }} />
      {/* Image banner — fills a 16:9 aspect area, object-contain so the WHOLE
          table photo is visible regardless of orientation. Soft dark background fills any
          letterboxed area so the card still looks deliberate. */}
      <div
        className="relative w-full bg-gray-100 dark:bg-[#0a0a0a] overflow-hidden shrink-0"
        style={{ aspectRatio: "16 / 9" }}
      >
        {table.image_url ? (
          <NextImage
            src={table.image_url}
            alt={table.name}
            fill
            sizes="(max-width: 768px) 50vw, 25vw"
            className="object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-7xl opacity-30">
            {typeIcon[table.type] ?? "🎯"}
          </div>
        )}
        <span className="absolute top-3 right-3 text-xs font-black px-2.5 py-1 rounded bg-black/60 backdrop-blur-sm text-white uppercase tracking-wider">
          Idle
        </span>
      </div>
      <div className="flex flex-col flex-1 p-5 gap-4">
        <p className="font-extrabold text-gray-900 dark:text-white text-2xl leading-tight mb-0.5">
          {fmtName(table.name)}
        </p>
        <p className="text-lg font-bold text-gray-500 dark:text-[#bbb] flex-1">
          {formatCurrency(table.hourly_rate)}/hr
        </p>
        {upcomingBooking ? (
          <div className="mt-3 flex items-center justify-between gap-1">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-1 rounded-full truncate"
              style={{ background: "rgba(245,158,11,0.18)", color: "#f59e0b" }}
            >
              Next {fmtTime(upcomingBooking.scheduled_start)} → {fmtTime(upcomingBooking.scheduled_end)}
            </span>
            <span className="text-sm font-bold text-gray-500 dark:text-[#888] shrink-0">Tap →</span>
          </div>
        ) : (
          <p className="text-sm font-extrabold mt-3 text-right" style={{ color: "#D4541A" }}>
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

// ── Running card ──────────────────────────────────────────────────────────────

function RunningCountdown({ expectedEnd, actualStart }: { expectedEnd: string | null; actualStart: string | null }) {
  const now = useNowSampled(1000); // Ticks locally every second for precise visual countdown

  let countdown = "";
  let isFiveMinWarning = false;
  let isOvertime = false;
  let progressPct = 0;

  if (expectedEnd) {
    const exp = new Date(expectedEnd);
    const diffMs = exp.getTime() - now.getTime();
    const signed = formatSignedCountdown(exp, now);
    countdown = signed.text;
    isOvertime = signed.isOvertime;
    isFiveMinWarning = diffMs > 0 && diffMs < 5 * 60 * 1000;
    if (actualStart && diffMs > 0) {
      progressPct = Math.min(100, Math.max(0,
        (now.getTime() - new Date(actualStart).getTime()) /
        (exp.getTime() - new Date(actualStart).getTime()) * 100
      ));
    }
  }

  const timerColor = isOvertime ? "#ef4444" : isFiveMinWarning ? "#f59e0b" : "#10b981";

  return (
    <>
      {/* Prominent centered Timer Box */}
      <div className="my-2 py-8 flex flex-col items-center justify-center rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
        <span
          className="text-5xl lg:text-6xl font-black font-mono tracking-widest tabular-nums"
          style={{ color: timerColor }}
        >
          {countdown ? `${countdown}` : "00:00"}
        </span>
        <span className="text-xs font-black uppercase tracking-widest text-gray-500 dark:text-[#aaa] mt-2">
          {isOvertime ? "Overtime" : "Time Remaining"}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="h-2 rounded-full overflow-hidden"
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
    </>
  );
}

function RunningCardImpl({ table, item, order, locationId, isSelected, onClick }: {
  table: TableWithStatus;
  item: OrderItem;
  order: POSOrder | undefined;
  locationId: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  const now            = useNowSampled(10000); // 10-second tick beats global 1Hz store subscription
  const closingTime    = usePOSStore((s) => s.closingTime);
  const patchOrderItem = usePOSStore((s) => s.patchOrderItem);
  const qc             = useQueryClient();
  const [extending, setExtending] = useState<number | null>(null);

  // Client-side query to always get the absolute freshest loyalty points balance
  // directly from customer profiles, resolving any lag in pos-orders query updates.
  const { data: customerInfo } = useQuery({
    queryKey: ["customer-points", order?.customer_phone],
    queryFn: async () => {
      if (!order?.customer_phone) return null;
      const res = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(order.customer_phone)}`);
      if (!res.ok) return null;
      const body = await res.json() as { found: boolean; customer: { points_balance: number; membership_discount_pct?: number; active_memberships?: any[] } | null };
      return body.found ? body.customer : null;
    },
    enabled: !!order?.customer_phone,
    staleTime: 10000,
  });

  const points = customerInfo?.points_balance ?? order?.customer_points ?? 0;
  const posTablesRef = usePOSStore((s) => s.tables);
  const activeItems = (order?.items ?? [item]).filter((i) => !i.is_deleted && i.status !== "cancelled" && i.status !== "scheduled");
  const activeExtras = (order?.extras ?? []).filter((e) => !e.is_deleted);
  const publicDiscount = (order as any)?.public_discount_amount ?? order?.discount_amount ?? 0;
  const isMembershipApplied = !!order?.membership_id;
  const applicableMemberships = isMembershipApplied && customerInfo?.active_memberships
    ? customerInfo.active_memberships.filter((m: any) => m.id === order.membership_id)
    : [];
  const freeHrsDiscount = computeFreeHoursDiscount(activeItems, applicableMemberships, now, posTablesRef);
  const applicableMembershipPct = applicableMemberships.reduce((max: number, m: any) => {
    const pct = m.plan?.discount_pct ?? 0;
    return pct > max ? pct : max;
  }, 0);
  const liveBill = order
    ? calculateBill(activeItems, activeExtras, now, null, order.advance_paid ?? 0, publicDiscount, applicableMembershipPct, freeHrsDiscount).totalDue
    : calculateBill([item], [], now).subtotal;
  const startedAt = item.actual_start
    ? new Date(item.actual_start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : "";

  let isFiveMinWarning = false;
  let isOvertime       = false;

  if (item.expected_end) {
    const exp    = new Date(item.expected_end);
    const diffMs = exp.getTime() - now.getTime();
    isOvertime   = now.getTime() > exp.getTime();
    isFiveMinWarning = diffMs > 0 && diffMs < 5 * 60 * 1000;
  }

  // Today's shop closing in ms. Treat closings <6am as next-day (midnight cross).
  const closingMs = (() => {
    if (!closingTime) return Infinity;
    const [ch, cm] = closingTime.split(":").map(Number);
    const close = new Date(now);
    close.setHours(ch, cm, 0, 0);
    if (close.getTime() < now.getTime() && ch < 6) close.setDate(close.getDate() + 1);
    return close.getTime();
  })();

  const anchorMs = item.expected_end ? new Date(item.expected_end).getTime() : now.getTime();
  const bookingBoundaryMs = table.upcomingBooking
    ? new Date(table.upcomingBooking.scheduled_start).getTime()
    : Infinity;
  const ceilingMs = Math.min(closingMs, bookingBoundaryMs);
  const maxExtendMins = Math.max(0, Math.floor((ceilingMs - anchorMs) / 60000));

  const canExtend15 = maxExtendMins >= 15;
  const canExtend30 = maxExtendMins >= 30;
  const accentColor    = isOvertime ? "#ef4444" : isFiveMinWarning ? "#f59e0b" : "#10b981";
  const bgClass        = isOvertime
    ? "bg-red-50 hover:bg-red-100 dark:bg-[rgba(239,68,68,0.08)] dark:hover:bg-[rgba(239,68,68,0.16)]"
    : isFiveMinWarning
    ? "bg-amber-50 hover:bg-amber-100 dark:bg-[rgba(245,158,11,0.07)] dark:hover:bg-[rgba(245,158,11,0.16)]"
    : "bg-emerald-50 hover:bg-emerald-100 dark:bg-[rgba(16,185,129,0.06)] dark:hover:bg-[rgba(16,185,129,0.14)]";

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
      className={`rounded-xl flex flex-col min-h-[440px] ${bgClass} overflow-hidden cursor-pointer select-none
        transition-colors duration-150 ease-out
        active:scale-[0.99]
        ${isSelected ? "ring-2 ring-[#D4541A] ring-offset-1 shadow-md" : "shadow-sm"}`}
      style={{ border: isSelected ? undefined : `1px solid ${accentColor}22` }}
    >
      <div style={{ height: 4, background: accentColor, flexShrink: 0 }} />
      <div className="flex flex-col flex-1 p-5 gap-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <TableThumb table={table} size={36} />
            <span className="text-base font-black text-gray-800 dark:text-[#ddd] truncate">
              {fmtName(table.name)}
            </span>
          </div>
          <span
            className={`text-xs font-black px-2.5 py-1 rounded text-white shrink-0 ml-1 uppercase tracking-wider ${
              isOvertime || isFiveMinWarning ? "animate-pulse" : ""
            }`}
            style={{ background: accentColor }}
          >
            {isOvertime ? "Over time" : isFiveMinWarning ? "Ending" : "Live"}
          </span>
        </div>

        {/* Customer, Live Bill & Loyalty Points */}
        <div className="flex items-start justify-between gap-3 mt-1">
          <div className="min-w-0 flex-1">
            <p className="font-black text-gray-900 dark:text-white text-2xl leading-tight truncate">
              {order?.customer_name ?? "—"}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="text-xs font-mono font-bold tabular-nums text-gray-500 dark:text-[#aaa]">
                Started {startedAt}
              </span>
              {order?.customer_phone && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-black">
                  ★ {points} pts
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="font-black text-2xl tabular-nums block" style={{ color: "#D4541A" }}>
              {formatCurrency(liveBill)}
            </span>
          </div>
        </div>

        {/* People / controller count badge (only when tier pricing applied) */}
        {item.num_people != null && (
          <span
            className="inline-flex w-fit items-center gap-1.5 text-xs font-black px-2 py-0.5 rounded uppercase tracking-wider"
            style={{ background: "rgba(212,84,26,0.12)", color: "#D4541A" }}
          >
            {item.num_people} {table.type === "ps5" ? "ctrl" : "ppl"}
          </span>
        )}

        {/* Prominent centered Timer Box & Progress bar */}
        <RunningCountdown expectedEnd={item.expected_end} actualStart={item.actual_start} />

        {/* Upcoming booking — name + slot + click-to-copy phone */}
        {table.upcomingBooking && (
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full"
              style={{ background: "rgba(245,158,11,0.15)", color: "#d97706" }}
            >
              → {table.upcomingBooking.order?.customer_name ?? "Booking"} · {fmtTime(table.upcomingBooking.scheduled_start)} – {fmtTime(table.upcomingBooking.scheduled_end)}
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
                className="inline-flex items-center gap-1 text-xs font-mono font-semibold px-2 py-1 rounded
                  bg-gray-100 dark:bg-[#1f1f1f] hover:bg-[#f59e0b]/15 text-gray-700 dark:text-[#ddd] hover:text-[#f59e0b] transition"
                title="Click to copy number"
              >
                <Phone className="h-3 w-3" />
                {table.upcomingBooking.order.customer_phone}
              </button>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-auto pt-2" onClick={(e) => e.stopPropagation()}>
          {canExtend15 && (
            <button
              onClick={(e) => quickExtend(e, 15)}
              disabled={!!extending}
              className="flex-1 py-2.5 rounded-xl text-sm font-extrabold transition-all active:scale-95 disabled:opacity-40"
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
              className="flex-1 py-2.5 rounded-xl text-sm font-extrabold transition-all active:scale-95 disabled:opacity-40"
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
            className="flex-1 py-2.5 rounded-xl text-sm font-extrabold text-white transition-all active:scale-95 disabled:opacity-40 hover:brightness-110"
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
  a.table.image_url === b.table.image_url &&
  a.item.id === b.item.id &&
  a.item.status === b.item.status &&
  a.item.expected_end === b.item.expected_end &&
  a.item.actual_start === b.item.actual_start &&
  a.item.num_people === b.item.num_people &&
  a.item.rate_per_hour === b.item.rate_per_hour &&
  a.order?.customer_name === b.order?.customer_name &&
  a.order?.customer_points === b.order?.customer_points &&
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
  // BookedCard only displays "in N min" / "Arriving now" — coarse enough that
  // a 10s sample beats subscribing to the 1Hz clock (which would re-render
  // every booked card 60×/min instead of 6).
  const now = useNowSampled(10_000);
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

    // Optimistic: flip the order_item to running with the booked anchor times
    // so the BookedCard swaps for a RunningCard on the very next render. The
    // server applies identical logic for on-time arrival (actual_start =
    // scheduled_start, expected_end = scheduled_end). For early arrival the
    // server shifts those — refetch reconciles within ~500ms.
    const orderItemId = (booking as { order_item_id?: string }).order_item_id;
    const prevSnapshot = orderItemId
      ? usePOSStore.getState().openOrders
          .flatMap((o) => o.items)
          .find((i) => i.id === orderItemId)
      : null;
    if (orderItemId) {
      usePOSStore.getState().patchOrderItem(orderItemId, {
        status:       "running",
        actual_start: booking.scheduled_start,
        expected_end: booking.scheduled_end,
      });
    }

    const res = await fetch(`/api/bookings/${booking.id}/checkin`, { method: "POST" });
    if (!res.ok) {
      // Roll back the optimistic flip
      if (orderItemId && prevSnapshot) {
        usePOSStore.getState().patchOrderItem(orderItemId, {
          status:       prevSnapshot.status,
          actual_start: prevSnapshot.actual_start,
          expected_end: prevSnapshot.expected_end,
        });
      }
      const body = await res.json().catch(() => ({})) as { error?: string };
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
      className={`rounded-xl flex flex-col min-h-[380px] overflow-hidden cursor-pointer select-none
        bg-amber-50 hover:bg-amber-100
        dark:bg-[rgba(245,158,11,0.05)] dark:hover:bg-[rgba(245,158,11,0.13)]
        transition-colors duration-150 ease-out
        active:scale-[0.99]
        ${isSelected ? "ring-2 ring-[#D4541A] ring-offset-1 shadow-md" : "shadow-sm"}`}
      style={{ border: isSelected ? undefined : "1px solid rgba(245,158,11,0.22)" }}
    >
      <div style={{ height: 4, background: "#f59e0b", flexShrink: 0 }} />
      <div className="flex flex-col flex-1 p-5 gap-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <TableThumb table={table} size={36} />
            <span className="text-base font-black text-gray-800 dark:text-[#ddd] truncate">
              {fmtName(table.name)}
            </span>
          </div>
          <span
            className="text-xs font-black px-2.5 py-1 rounded text-white shrink-0 ml-1 uppercase tracking-wider"
            style={{ background: "#f59e0b" }}
          >
            Booked
          </span>
        </div>

        {/* Customer details */}
        <div className="space-y-1">
          <p className="font-black text-gray-900 dark:text-white text-2xl leading-tight truncate">
            {booking.order?.customer_name}
          </p>
          <div className="flex flex-wrap items-center gap-2">
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
                className="inline-flex items-center gap-1 text-xs font-mono font-bold text-gray-500 dark:text-[#aaa] hover:text-[#f59e0b] dark:hover:text-[#f59e0b] truncate"
                title="Click to copy number"
              >
                <Phone className="h-3 w-3" />
                {booking.order.customer_phone}
              </button>
            )}
            <span className="text-xs text-gray-400 font-bold">
              Slot: {fmtTime(booking.scheduled_start)} – {fmtTime(booking.scheduled_end)}
            </span>
          </div>
        </div>

        {/* Big centered Booked countdown/timer */}
        <div className="my-2 py-8 flex flex-col items-center justify-center rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
          <span className="text-4xl lg:text-5xl font-black font-mono tracking-widest text-[#f59e0b] tabular-nums">
            {isOverdue
              ? `${Math.abs(Math.ceil(diffMs / 60000))}m late`
              : isImminent
              ? "Arriving now!"
              : `${minsAway}m`}
          </span>
          <span className="text-xs font-black uppercase tracking-widest text-gray-500 dark:text-[#aaa] mt-2">
            {isOverdue ? "Overdue" : isImminent ? "Status" : "Arriving In"}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mt-auto pt-2" onClick={(e) => e.stopPropagation()}>
          {!confirmNoshow ? (
            <>
              <button
                onClick={checkIn}
                disabled={loadingCheckin || loadingNoshow}
                className="flex-1 py-2.5 rounded-xl text-sm font-extrabold text-white transition-all active:scale-95 disabled:opacity-40"
                style={{ background: "#f59e0b" }}
              >
                {loadingCheckin ? "…" : "Check In"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmNoshow(true); }}
                disabled={loadingCheckin || loadingNoshow}
                className="px-4 py-2.5 rounded-xl text-sm font-extrabold transition-all active:scale-95 disabled:opacity-40
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
                className="flex-1 py-2.5 rounded-xl text-sm font-extrabold text-white transition-all active:scale-95 disabled:opacity-40"
                style={{ background: "#ef4444" }}
              >
                {loadingNoshow ? "…" : "Confirm"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmNoshow(false); }}
                disabled={loadingNoshow}
                className="px-4 py-2.5 rounded-xl text-sm font-extrabold transition-all
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
  a.table.image_url === b.table.image_url &&
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

  const { data: customerInfo } = useQuery({
    queryKey: ["customer-points", order?.customer_phone],
    queryFn: async () => {
      if (!order?.customer_phone) return null;
      const res = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(order.customer_phone)}`);
      if (!res.ok) return null;
      const body = await res.json() as { found: boolean; customer: { points_balance: number; membership_discount_pct?: number; active_memberships?: any[] } | null };
      return body.found ? body.customer : null;
    },
    enabled: !!order?.customer_phone,
    staleTime: 10000,
  });

  const posTablesRef = usePOSStore((s) => s.tables);
  const activeItems = order.items.filter((i) => !i.is_deleted && i.status !== "cancelled" && i.status !== "scheduled");
  const activeExtras = order.extras.filter((e) => !e.is_deleted);
  const publicDiscount = (order as any)?.public_discount_amount ?? order.discount_amount ?? 0;
  const isMembershipApplied = !!order?.membership_id;
  const applicableMemberships = isMembershipApplied && customerInfo?.active_memberships
    ? customerInfo.active_memberships.filter((m: any) => m.id === order.membership_id)
    : [];
  const freeHrsDiscount = computeFreeHoursDiscount(activeItems, applicableMemberships, new Date(), posTablesRef);
  const applicableMembershipPct = applicableMemberships.reduce((max: number, m: any) => {
    const pct = m.plan?.discount_pct ?? 0;
    return pct > max ? pct : max;
  }, 0);
  const billDue = calculateBill(
    activeItems,
    activeExtras,
    new Date(),
    null,
    order.advance_paid ?? 0,
    publicDiscount,
    applicableMembershipPct,
    freeHrsDiscount
  ).totalDue;

  return (
    <div
      onClick={onClick}
      className={`rounded-xl flex flex-col min-h-[380px] bg-orange-50 dark:bg-[rgba(212,84,26,0.07)] overflow-hidden cursor-pointer transition-all select-none
        ${isSelected ? "ring-2 ring-[#D4541A] ring-offset-1 shadow-md" : "shadow-sm hover:shadow-md"}`}
      style={{ border: isSelected ? undefined : "1px solid rgba(212,84,26,0.22)" }}
    >
      <div style={{ height: 4, background: "#D4541A", flexShrink: 0 }} />
      <div className="flex flex-col flex-1 p-5 gap-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <TableThumb table={table} size={36} />
            <span className="text-base font-black text-gray-800 dark:text-[#ddd] truncate">
              {fmtName(table.name)}
            </span>
          </div>
          <span
            className="text-xs font-black px-2.5 py-1 rounded text-white shrink-0 ml-1 uppercase tracking-wider"
            style={{ background: "#D4541A" }}
          >
            Bill Ready
          </span>
        </div>

        {/* Customer */}
        <div>
          <p className="font-black text-gray-900 dark:text-white text-2xl leading-tight truncate">
            {order.customer_name}
          </p>
          <p className="text-xs font-bold text-gray-600 dark:text-[#aaa]">Session ended</p>
        </div>

        {/* Big centered Bill amount */}
        <div className="my-2 py-8 flex flex-col items-center justify-center rounded-2xl bg-orange-100/30 dark:bg-orange-950/20 border border-orange-500/10">
          <span className="text-4xl lg:text-5xl font-black font-mono tracking-widest tabular-nums" style={{ color: "#D4541A" }}>
            {formatCurrency(billDue)}
          </span>
          <span className="text-xs font-black uppercase tracking-widest text-gray-500 dark:text-[#aaa] mt-2">
            Amount Due
          </span>
        </div>

        {/* Quick collect — goes straight to finalize modal */}
        <button
          onClick={(e) => { e.stopPropagation(); setFinalizeOrderId(order.id); }}
          className="w-full py-2.5 rounded-xl text-sm font-extrabold text-white transition-all active:scale-95 hover:brightness-110 mt-auto"
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
  order_item: Pick<OrderItem, "table_id" | "status" | "selected_mode_name"> | null;
};

function UpcomingStrip({ locationId }: { locationId: string }) {
  const now    = useNowSampled(30_000);
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
      const oi = b.order_item as Pick<OrderItem, "table_id" | "status" | "selected_mode_name"> | null;
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
          const oi         = booking.order_item as Pick<OrderItem, "table_id" | "status" | "selected_mode_name"> | null;
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
                  {table.name}{oi?.selected_mode_name ? ` (${oi.selected_mode_name.replace(/ Mode$/i, "")})` : ""}
                </span>
              )}
              <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                {booking.order?.customer_name}
              </p>
              <p className="font-mono text-xs font-bold tabular-nums mt-0.5" style={{ color: "#f59e0b" }}>
                {fmtTime(booking.scheduled_start)} – {fmtTime(booking.scheduled_end)}
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
          {tables.map((table) => {
            const item              = table.activeOrderItem;
            const isRunning         = !!item && item.status === "running";
            const isBillReady       = !!item && item.status === "finished";
            const billReadyOrder    = isBillReady ? openOrders.find((o) => o.items.some((i) => i.id === item.id)) : undefined;
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
