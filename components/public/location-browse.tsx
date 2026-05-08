"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
import { formatCurrency } from "@/lib/utils";
import type { Location, Table } from "@/lib/supabase/types";
import { ShoppingCart, ArrowLeft, X, ChevronRight, Clock, Check } from "lucide-react";
import { useTheme } from "next-themes";

/* ── Type config ─────────────────────────── */
const TYPE: Record<string, { label: string; emoji: string; accent: string; grad: string }> = {
  snooker:  { label: "Snooker",  emoji: "🎱", accent: "#D4541A", grad: "linear-gradient(135deg,#D4541A 0%,#7A2508 100%)" },
  pool:     { label: "Pool",     emoji: "🎱", accent: "#1E6B4A", grad: "linear-gradient(135deg,#1E6B4A 0%,#0B3324 100%)" },
  ps5:      { label: "PS5",      emoji: "🎮", accent: "#6D28D9", grad: "linear-gradient(135deg,#6D28D9 0%,#3B0D8E 100%)" },
  foosball: { label: "Foosball", emoji: "⚽", accent: "#B45309", grad: "linear-gradient(135deg,#B45309 0%,#6B3203 100%)" },
};
function cfg(type: string) {
  return TYPE[type] ?? { label: type, emoji: "🎯", accent: "#555", grad: "linear-gradient(135deg,#444,#222)" };
}

/* ── Helpers ─────────────────────────────── */
function isOpen(opening: string, closing: string) {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = opening.split(":").map(Number);
  const [ch, cm] = closing.split(":").map(Number);
  const openMins = oh * 60 + om;
  const closeMins = ch * 60 + cm;
  if (closeMins < openMins) return cur >= openMins || cur < closeMins;
  return cur >= openMins && cur < closeMins;
}

function fmt(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}${m ? `:${String(m).padStart(2, "0")}` : ""} ${ap}`;
}

function visibleSlots(opening: string, closing: string, dateStr: string): string[] {
  const [oh, om] = opening.split(":").map(Number);
  const [ch, cm] = closing.split(":").map(Number);
  const openMins = oh * 60 + om;
  let end = ch * 60 + cm - 30;
  const crossesMidnight = end < openMins;
  if (crossesMidnight) end += 24 * 60;

  const today = new Date().toISOString().split("T")[0];
  const filterByTime = dateStr === today;
  const now = new Date();
  const curRaw   = now.getHours() * 60 + now.getMinutes();
  const closeMins = ch * 60 + cm;
  // midnight-crossing: curRaw < closeMins means we're in the early-morning part of
  // the session (e.g. 1 AM) → shift into 24h+ zone. Otherwise (e.g. 7 AM before
  // opening) we're outside the session → start filter from openMins, showing all slots.
  const curMins = crossesMidnight
    ? (curRaw < closeMins ? curRaw + 24 * 60 : openMins)
    : curRaw;

  const list: string[] = [];
  for (let m = openMins; m <= end; m += 30) {
    if (filterByTime && m < curMins) continue;
    const norm = m % (24 * 60);
    list.push(`${String(Math.floor(norm / 60)).padStart(2, "0")}:${String(norm % 60).padStart(2, "0")}`);
  }
  return list;
}

/* Max bookable duration for a given slot before closing */
function maxBookableMins(slotStr: string, opening: string, closing: string): number {
  const [sh, sm] = slotStr.split(":").map(Number);
  const [oh, om] = opening.split(":").map(Number);
  const [ch, cm] = closing.split(":").map(Number);
  const openMins  = oh * 60 + om;
  let slotRaw  = sh * 60 + sm;
  let closeRaw = ch * 60 + cm;
  if (closeRaw < openMins) {
    closeRaw += 24 * 60;
    if (slotRaw < openMins) slotRaw += 24 * 60;
  }
  return Math.max(0, closeRaw - slotRaw);
}

/* 7-day date strip */
function buildDays() {
  const days = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    days.push({
      iso: d.toISOString().split("T")[0],
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }),
    });
  }
  return days;
}

const DURATIONS = [30, 60, 90, 120, 180];

/* ── Component ───────────────────────────── */
interface Props { location: Location; tables: Table[] }

export function LocationBrowse({ location, tables }: Props) {
  const cart = useCartStore();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted]       = useState(false);
  const [filter, setFilter]         = useState("all");
  const [date, setDate]             = useState(new Date().toISOString().split("T")[0]);
  const [booking, setBooking]       = useState<Table | null>(null);
  const [slot, setSlot]             = useState<string | null>(null);
  const [dur, setDur]               = useState(60);
  const [errorImgs, setErrorImgs]   = useState<Set<string>>(new Set());
  const [expandedSlots, setExpandedSlots] = useState<Set<string>>(new Set());

  useEffect(() => { setMounted(true); }, []);

  if (cart.locationId !== location.id) cart.setLocation(location.id);

  const dark     = !mounted ? false : resolvedTheme === "dark";
  const open     = isOpen(location.opening_time, location.closing_time);
  const types    = ["all", ...new Set(tables.map(t => t.type))];
  const shown    = filter === "all" ? tables : tables.filter(t => t.type === filter);
  const days     = useMemo(buildDays, []);
  const cartCount = cart.items.length;

  // Pre-compute booked slot keys for O(1) lookup: "tableId::scheduledStartISO"
  const bookedKeys = useMemo(
    () => new Set(cart.items.map(i => `${i.tableId}::${i.scheduledStart}`)),
    [cart.items]
  );

  /* theme tokens */
  const bg       = dark ? "#0A0A0A" : "#F7F5F2";
  const surface  = dark ? "#111"    : "#FFFFFF";
  const border   = dark ? "#222"    : "#EBEBEB";
  const hdrBg    = dark ? "rgba(10,10,10,0.9)" : "rgba(247,245,242,0.92)";
  const textPri  = dark ? "#FFF"    : "#111";
  const textSec  = dark ? "#888"    : "#666";
  const textMut  = dark ? "#555"    : "#AAA";
  const chipBg   = dark ? "#1A1A1A" : "#EFEFEF";
  const inputBg  = dark ? "#1A1A1A" : "#F2EFE9";
  const inputBdr = dark ? "#2A2A2A" : "#DDD";
  const dateBg   = dark ? "#111"    : "#FFF";

  const sheetType  = booking ? cfg(booking.type) : cfg("snooker");
  const maxDur     = (booking && slot) ? maxBookableMins(slot, location.opening_time, location.closing_time) : Infinity;
  const validDurs  = DURATIONS.filter(d => d <= maxDur);
  const safeDur    = validDurs.includes(dur) ? dur : (validDurs[validDurs.length - 1] ?? 30);
  const total      = booking ? formatCurrency((safeDur / 60) * booking.hourly_rate) : "";

  function openSheet(table: Table, preSlot?: string) {
    setBooking(table);
    setSlot(preSlot ?? null);
    setDur(60);
  }

  function addToCart(t: Table) {
    if (!slot) return;
    const startIso = new Date(`${date}T${slot}:00`).toISOString();
    if (cart.items.some(i => i.tableId === t.id && i.scheduledStart === startIso)) {
      setBooking(null);
      setSlot(null);
      return;
    }
    const start = new Date(startIso);
    const end   = new Date(start.getTime() + safeDur * 60_000);
    cart.addItem({
      tableId: t.id, tableName: t.name, tableType: t.type,
      ratePerHour: t.hourly_rate,
      scheduledStart: start.toISOString(), scheduledEnd: end.toISOString(),
      durationMins: safeDur, amount: (safeDur / 60) * t.hourly_rate,
    });
    setBooking(null);
    setSlot(null);
  }

  return (
    <div className="min-h-screen" style={{ background: bg }}>

      {/* ── Header ──────────────────────────── */}
      <header
        className="sticky top-0 z-40 backdrop-blur-md border-b"
        style={{ background: hdrBg, borderColor: border }}
      >
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: chipBg, color: textSec }}
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="font-bold text-base truncate" style={{ color: textPri }}>
                {location.name}
              </h1>
              <span
                className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide"
                style={{
                  background: open ? "rgba(16,185,129,0.12)" : dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                  color: open ? "#10B981" : textMut,
                }}
              >
                {open ? "● Open" : "● Closed"}
              </span>
            </div>
          </div>
          <Link href={`/${location.slug}/book`} className="shrink-0">
            <button
              className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-sm text-white"
              style={{ background: "#111111" }}
            >
              <ShoppingCart className="h-4 w-4" />
              <span>Cart</span>
              {cartCount > 0 && (
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white" style={{ background: "#1E6B4A" }}>
                  {cartCount}
                </span>
              )}
            </button>
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 pt-5 pb-24">

        {/* ── Date strip ──────────────────────── */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-5 scrollbar-hide">
          {days.map(d => {
            const active = date === d.iso;
            return (
              <button
                key={d.iso}
                onClick={() => setDate(d.iso)}
                className="shrink-0 flex flex-col items-center px-4 py-2.5 rounded-2xl text-sm font-semibold transition-all duration-200"
                style={{
                  background:  active ? "#111111" : dateBg,
                  color:       active ? "#FFF" : textSec,
                  border:      `1.5px solid ${active ? "#111111" : border}`,
                  boxShadow:   active ? "0 4px 14px rgba(0,0,0,0.25)" : dark ? "none" : "0 1px 4px rgba(0,0,0,0.06)",
                  transform:   active ? "scale(1.04)" : "scale(1)",
                }}
              >
                <span className="text-xs font-medium opacity-80">{d.label.split(" ")[0]}</span>
                <span className="font-bold">{d.label.split(" ")[1] ?? d.label}</span>
              </button>
            );
          })}
        </div>

        {/* ── Filter chips ────────────────────── */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 scrollbar-hide">
          {types.map(t => {
            const active = filter === t;
            const tc     = t === "all" ? null : TYPE[t];
            const accent = t === "all" ? "#111111" : (tc?.accent ?? "#111111");
            const count  = t === "all" ? tables.length : tables.filter(tb => tb.type === t).length;
            return (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200"
                style={{
                  background: active ? accent : chipBg,
                  color:      active ? "#FFF" : textSec,
                  boxShadow:  active ? `0 4px 16px ${accent}40` : "none",
                  transform:  active ? "scale(1.04)" : "scale(1)",
                }}
              >
                {tc && <span>{tc.emoji}</span>}
                {t === "all" ? "All" : (tc?.label ?? t)}
                <span
                  className="text-xs rounded-full px-1.5 py-0.5 font-bold"
                  style={{
                    background: active ? "rgba(255,255,255,0.22)" : dark ? "#2A2A2A" : "#DDD",
                    color: active ? "#FFF" : textMut,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Cards ───────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {shown.map((table, i) => {
            const tc         = cfg(table.type);
            const imgFailed  = errorImgs.has(table.id);
            const slots      = visibleSlots(location.opening_time, location.closing_time, date);
            const isExpanded = expandedSlots.has(table.id);
            const SHOW       = 4;
            const displaySlots = isExpanded ? slots : slots.slice(0, SHOW);
            const hasMore    = slots.length > SHOW && !isExpanded;

            return (
              <div
                key={table.id}
                className="h-full"
                style={{
                  opacity:   mounted ? 1 : 0,
                  transform: mounted ? "translateY(0)" : "translateY(20px)",
                  transition: `opacity 400ms ${i * 60}ms ease-out, transform 400ms ${i * 60}ms ease-out`,
                }}
              >
                <div
                  className="rounded-2xl overflow-hidden border h-full flex flex-col"
                  style={{
                    background: surface,
                    borderColor: border,
                    boxShadow: dark ? "0 2px 20px rgba(0,0,0,0.5)" : "0 2px 12px rgba(0,0,0,0.07)",
                  }}
                >
                  {/* Image */}
                  <div className="relative overflow-hidden shrink-0" style={{ aspectRatio: "16/9" }}>
                    {table.image_url && !imgFailed ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={table.image_url}
                        alt={table.name}
                        className="w-full h-full object-cover"
                        onError={() => setErrorImgs(p => new Set([...p, table.id]))}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center" style={{ background: tc.grad }}>
                        <span className="text-5xl opacity-25">{tc.emoji}</span>
                      </div>
                    )}
                    {/* overlay on real images */}
                    {table.image_url && !imgFailed && (
                      <div className="absolute inset-0" style={{ background: "linear-gradient(to top,rgba(0,0,0,0.35) 0%,transparent 50%)" }} />
                    )}
                    <span className="absolute top-3 left-3 text-xs font-bold px-2.5 py-1 rounded-full text-white" style={{ background: tc.accent }}>
                      {tc.emoji} {tc.label}
                    </span>
                    <span
                      className="absolute top-3 right-3 text-xs font-bold px-2.5 py-1 rounded-full"
                      style={{
                        background: dark ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.92)",
                        color: tc.accent,
                        backdropFilter: "blur(8px)",
                      }}
                    >
                      {formatCurrency(table.hourly_rate)}/hr
                    </span>
                  </div>

                  {/* Info */}
                  <div className="p-4 flex flex-col flex-1">
                    <h3 className="font-bold text-[16px] leading-tight capitalize mb-0.5" style={{ color: textPri }}>
                      {table.name}
                    </h3>
                    {(table.size || table.description) && (
                      <p className="text-xs mb-3 line-clamp-1" style={{ color: textMut }}>
                        {[table.size, table.description].filter(Boolean).join(" · ")}
                      </p>
                    )}

                    {/* ── Time slots ─────────────────── */}
                    <div className="mt-auto">
                      {slots.length === 0 ? (
                        <p className="text-xs py-2 text-center" style={{ color: textMut }}>
                          No slots available for this date
                        </p>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5 mb-2">
                            <Clock className="h-3 w-3" style={{ color: textMut }} />
                            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: textMut }}>
                              Available slots
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 mb-3">
                            {displaySlots.map(s => {
                              const slotIso = new Date(`${date}T${s}:00`).toISOString();
                              const inCart  = bookedKeys.has(`${table.id}::${slotIso}`);

                              if (inCart) {
                                return (
                                  <div
                                    key={s}
                                    title="Already in your cart"
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold select-none pointer-events-none"
                                    style={{
                                      background: "#10B981",
                                      color: "#fff",
                                      border: "1.5px solid #059669",
                                    }}
                                  >
                                    <Check className="h-3 w-3 shrink-0" />
                                    {fmt(s)}
                                  </div>
                                );
                              }

                              return (
                                <button
                                  key={s}
                                  onClick={() => openSheet(table, s)}
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
                                  style={{
                                    background: chipBg,
                                    color: textSec,
                                    border: `1.5px solid ${border}`,
                                  }}
                                  onMouseEnter={e => {
                                    (e.currentTarget as HTMLButtonElement).style.background = "#111111";
                                    (e.currentTarget as HTMLButtonElement).style.color = "#FFF";
                                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#111111";
                                  }}
                                  onMouseLeave={e => {
                                    (e.currentTarget as HTMLButtonElement).style.background = chipBg;
                                    (e.currentTarget as HTMLButtonElement).style.color = textSec;
                                    (e.currentTarget as HTMLButtonElement).style.borderColor = border;
                                  }}
                                >
                                  {fmt(s)}
                                </button>
                              );
                            })}
                            {hasMore && (
                              <button
                                onClick={() => setExpandedSlots(p => new Set([...p, table.id]))}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                                style={{ background: chipBg, color: textSec, border: `1.5px solid ${border}` }}
                              >
                                +{slots.length - SHOW} more
                              </button>
                            )}
                          </div>
                        </>
                      )}

                      <button
                        className="w-full py-3 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                        style={{ background: "#111111", boxShadow: "0 4px 14px rgba(0,0,0,0.3)" }}
                        onClick={() => openSheet(table)}
                      >
                        Book Now <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {shown.length === 0 && (
          <div className="text-center py-24" style={{ color: textMut }}>
            <p className="text-5xl mb-4">🎱</p>
            <p className="font-semibold">No tables available</p>
          </div>
        )}
      </div>

      {/* ── Booking sheet ───────────────────── */}
      {booking && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            style={{ animation: "fadeIn 200ms ease-out" }}
            onClick={() => setBooking(null)}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 overflow-y-auto scrollbar-hide"
            style={{
              background: surface,
              borderTop: `3px solid ${sheetType.accent}`,
              borderRadius: "22px 22px 0 0",
              maxHeight: "92dvh",
              animation: "slideUp 300ms cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: inputBdr }} />
            </div>

            <div className="px-5 pt-2 pb-10 max-w-lg mx-auto space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-block text-xs font-bold px-2.5 py-0.5 rounded-full text-white mb-2" style={{ background: sheetType.accent }}>
                    {sheetType.emoji} {sheetType.label}
                    {booking.size ? ` · ${booking.size}` : ""}
                  </span>
                  <h3 className="text-xl font-bold capitalize" style={{ color: textPri }}>{booking.name}</h3>
                  <p className="text-sm mt-0.5" style={{ color: textSec }}>{formatCurrency(booking.hourly_rate)}/hr</p>
                </div>
                <button className="p-2 rounded-full shrink-0" style={{ background: inputBg, color: textSec }} onClick={() => setBooking(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Selected date + time summary */}
              <div
                className="flex items-center justify-between px-4 py-3 rounded-xl"
                style={{ background: inputBg, border: `1.5px solid ${inputBdr}` }}
              >
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: textMut }}>Date</p>
                  <p className="text-sm font-semibold" style={{ color: textPri }}>
                    {new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                  </p>
                </div>
                {slot && (
                  <>
                    <div className="w-px h-8" style={{ background: inputBdr }} />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: textMut }}>Start Time</p>
                      <p className="text-sm font-semibold" style={{ color: textPri }}>{fmt(slot)}</p>
                    </div>
                  </>
                )}
              </div>

              {/* Time slots — shown if none pre-selected */}
              {!slot && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: textMut }}>
                    Select Start Time
                  </label>
                  <div className="grid grid-cols-4 gap-2 max-h-44 overflow-y-auto scrollbar-hide">
                    {visibleSlots(location.opening_time, location.closing_time, date).map(s => (
                      <button
                        key={s}
                        onClick={() => setSlot(s)}
                        className="py-2.5 rounded-xl text-xs font-semibold transition-all"
                        style={{
                          background: inputBg,
                          color: textSec,
                          border: `1.5px solid ${inputBdr}`,
                        }}
                      >
                        {fmt(s)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Change time link */}
              {slot && (
                <button
                  className="text-xs font-semibold underline"
                  style={{ color: sheetType.accent }}
                  onClick={() => setSlot(null)}
                >
                  Change time
                </button>
              )}

              {/* Duration */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: textMut }}>
                  Duration
                </label>
                <div className="flex gap-2 flex-wrap">
                  {validDurs.map(d => {
                    const active = safeDur === d;
                    const label  = d >= 60 ? `${Math.floor(d / 60)}h${d % 60 ? ` ${d % 60}m` : ""}` : `${d}m`;
                    return (
                      <button
                        key={d}
                        onClick={() => setDur(d)}
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
                        style={{
                          background: active ? sheetType.accent : inputBg,
                          color:      active ? "#FFF" : textSec,
                          border:     `1.5px solid ${active ? sheetType.accent : inputBdr}`,
                          boxShadow:  active ? `0 4px 12px ${sheetType.accent}40` : "none",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Total */}
              {slot && (
                <div className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: inputBg, border: `1.5px solid ${inputBdr}` }}>
                  <span className="text-sm" style={{ color: textSec }}>Total</span>
                  <span className="text-xl font-bold" style={{ color: sheetType.accent }}>{total}</span>
                </div>
              )}

              {/* CTA */}
              <button
                className="w-full py-4 rounded-xl font-bold text-white text-base transition-all active:scale-[0.98] disabled:opacity-40"
                style={{
                  background: "#111111",
                  boxShadow: slot ? "0 8px 24px rgba(0,0,0,0.35)" : "none",
                }}
                disabled={!slot}
                onClick={() => addToCart(booking)}
              >
                {slot ? `Add to Cart — ${total}` : "Select a time slot above"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
