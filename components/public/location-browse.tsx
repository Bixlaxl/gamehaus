"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
import { formatCurrency } from "@/lib/utils";
import type { Location, Table } from "@/lib/supabase/types";
import { ShoppingCart, ArrowLeft, X, ChevronRight, Check } from "lucide-react";
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
  const openMins  = oh * 60 + om;
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

/* Returns the HH:MM string 15 minutes after slotStart */
function slotEndTime(slotStart: string): string {
  const [h, m] = slotStart.split(":").map(Number);
  const total = h * 60 + m + 15;
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
}

/* 15-min slots from opening to (closing - 15), filtered to current time on today */
function visibleSlots(opening: string, closing: string, dateStr: string): string[] {
  const [oh, om] = opening.split(":").map(Number);
  const [ch, cm] = closing.split(":").map(Number);
  const openMins  = oh * 60 + om;
  const closeMins = ch * 60 + cm;
  let end = closeMins - 15;
  const crossesMidnight = end < openMins;
  if (crossesMidnight) end += 24 * 60;

  const today = new Date().toISOString().split("T")[0];
  const filterByTime = dateStr === today;
  const now    = new Date();
  const curRaw = now.getHours() * 60 + now.getMinutes();
  // Round up to next 15-min boundary so we never show a slot that's already started
  const curRounded = Math.ceil(curRaw / 15) * 15;

  // midnight-crossing: three cases:
  //   1. curRaw < closeMins  → early-morning post-midnight session → shift into 24h+ zone
  //   2. curRaw >= openMins  → daytime during session → filter from current rounded time
  //   3. else                → before opening → show all slots from opening
  const curMins = crossesMidnight
    ? (curRaw < closeMins ? curRounded + 24 * 60 : curRaw >= openMins ? curRounded : openMins)
    : curRounded;

  const list: string[] = [];
  for (let m = openMins; m <= end; m += 15) {
    if (filterByTime && m < curMins) continue;
    const norm = m % (24 * 60);
    list.push(`${String(Math.floor(norm / 60)).padStart(2, "0")}:${String(norm % 60).padStart(2, "0")}`);
  }
  return list;
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

/* ── Component ───────────────────────────── */
interface Props { location: Location; tables: Table[] }

export function LocationBrowse({ location, tables }: Props) {
  const cart = useCartStore();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted]         = useState(false);
  const [filter, setFilter]           = useState("all");
  const [date, setDate]               = useState(new Date().toISOString().split("T")[0]);
  const [booking, setBooking]         = useState<Table | null>(null);
  const [selectedSlots, setSelected]  = useState<string[]>([]);
  const [errorImgs, setErrorImgs]     = useState<Set<string>>(new Set());
  const [blockedRanges, setBlocked]   = useState<{ start: string; end: string }[]>([]);
  const [slotsLoading,  setSlotsLoading] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { cart.setLocation(location.id); }, [location.id]);

  // Re-fetch blocked ranges when date changes while booking sheet is open
  useEffect(() => {
    if (!booking) return;
    setBlocked([]);
    setSlotsLoading(true);
    fetch(`/api/tables/${booking.id}/slots?date=${date}`)
      .then((r) => r.json())
      .then((body: { success: boolean; data: { start: string; end: string }[] }) => {
        if (body.success) setBlocked(body.data);
      })
      .catch(() => {})
      .finally(() => setSlotsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, booking?.id]);

  const dark      = !mounted ? false : resolvedTheme === "dark";
  const open      = isOpen(location.opening_time, location.closing_time);
  const types     = ["all", ...new Set(tables.map(t => t.type))];
  const shown     = filter === "all" ? tables : tables.filter(t => t.type === filter);
  const days      = useMemo(buildDays, []);
  const cartCount = cart.items.length;

  /* All slots for the current sheet date */
  const allSlots = booking
    ? visibleSlots(location.opening_time, location.closing_time, date)
    : [];

  /* Derived totals from slot selection */
  const selMins  = selectedSlots.length * 15;
  const selLabel = selMins === 0 ? "" : selMins >= 60
    ? `${Math.floor(selMins / 60)}h${selMins % 60 ? ` ${selMins % 60}m` : ""}`
    : `${selMins}m`;
  const selTotal = (booking && selMins > 0)
    ? formatCurrency((selMins / 60) * booking.hourly_rate)
    : "";

  /* Slot is in customer's own cart (show green occupied card) */
  function isCartOccupied(tableId: string, slotDate: string, slotTime: string): boolean {
    const slotMs = new Date(`${slotDate}T${slotTime}:00`).getTime();
    return cart.items.some(item => {
      if (item.tableId !== tableId) return false;
      const startMs = new Date(item.scheduledStart).getTime();
      const endMs   = new Date(item.scheduledEnd).getTime();
      return slotMs >= startMs && slotMs < endMs;
    });
  }

  /* Slot is blocked by a walk-in or confirmed booking on the server — hide it entirely */
  function isServerBlocked(slotDate: string, slotTime: string): boolean {
    const slotMs = new Date(`${slotDate}T${slotTime}:00`).getTime();
    return blockedRanges.some(r => {
      const startMs = new Date(r.start).getTime();
      const endMs   = new Date(r.end).getTime();
      return slotMs >= startMs && slotMs < endMs;
    });
  }

  /* Combined — used for extend-stop logic */
  function isOccupied(tableId: string, slotDate: string, slotTime: string): boolean {
    return isCartOccupied(tableId, slotDate, slotTime) || isServerBlocked(slotDate, slotTime);
  }

  async function openSheet(table: Table) {
    setBooking(table);
    setSelected([]);
    setBlocked([]);
    // slotsLoading is set true by the useEffect that fires on booking?.id change
  }

  function closeSheet() {
    setBooking(null);
    setSelected([]);
    setBlocked([]);
    setSlotsLoading(false);
  }

  /*
   * Click logic:
   *  - nothing selected          → select this slot
   *  - same single slot clicked  → deselect (toggle off)
   *  - before current start      → reset to this slot
   *  - within selection          → shrink: deselect from this slot onwards
   *  - after selection end       → extend, stopping before any occupied slot
   */
  function handleSlotClick(s: string) {
    if (!booking) return;
    const idx = allSlots.indexOf(s);
    if (selectedSlots.length === 0) {
      setSelected([s]);
      return;
    }
    const startIdx = allSlots.indexOf(selectedSlots[0]);
    const endIdx   = allSlots.indexOf(selectedSlots[selectedSlots.length - 1]);

    if (idx < startIdx) {
      // Before current start → reset
      setSelected([s]);
    } else if (idx === startIdx && selectedSlots.length === 1) {
      // Toggle off the only selected slot
      setSelected([]);
    } else if (idx <= endIdx) {
      // Shrink: keep slots before the clicked one
      const next = allSlots.slice(startIdx, idx);
      setSelected(next.length > 0 ? next : []);
    } else {
      // Extend toward clicked slot, but stop before any occupied slot
      const range = allSlots.slice(startIdx, idx + 1);
      const firstOcc = range.findIndex((sl, i) => i > 0 && isOccupied(booking.id, date, sl));
      const effectiveEnd = firstOcc === -1 ? idx : startIdx + firstOcc - 1;
      if (effectiveEnd >= startIdx) {
        setSelected(allSlots.slice(startIdx, effectiveEnd + 1));
      }
    }
  }

  function addToCart(t: Table) {
    if (selectedSlots.length === 0) return;
    const firstSlot = selectedSlots[0];
    const lastSlot  = selectedSlots[selectedSlots.length - 1];
    const startIso  = new Date(`${date}T${firstSlot}:00`).toISOString();
    const endStr    = slotEndTime(lastSlot);
    // Handle midnight crossing: if end time is earlier than start, it's next day
    const endDate   = endStr < firstSlot ? addOneDay(date) : date;
    const endIso    = new Date(`${endDate}T${endStr}:00`).toISOString();
    const durationMins = selectedSlots.length * 15;

    if (cart.items.some(i => i.tableId === t.id && i.scheduledStart === startIso)) {
      closeSheet();
      return;
    }
    cart.addItem({
      tableId: t.id, tableName: t.name, tableType: t.type,
      ratePerHour: t.hourly_rate,
      scheduledStart: startIso, scheduledEnd: endIso,
      durationMins, amount: (durationMins / 60) * t.hourly_rate,
    });
    closeSheet();
  }

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

  const sheetType = booking ? cfg(booking.type) : cfg("snooker");

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
                onClick={() => { setDate(d.iso); setSelected([]); }}
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
            const tc        = cfg(table.type);
            const imgFailed = errorImgs.has(table.id);
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
                    background: surface, borderColor: border,
                    boxShadow: dark ? "0 2px 20px rgba(0,0,0,0.5)" : "0 2px 12px rgba(0,0,0,0.07)",
                  }}
                >
                  <div className="relative overflow-hidden shrink-0" style={{ aspectRatio: "16/9" }}>
                    {table.image_url && !imgFailed ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={table.image_url} alt={table.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                        onError={() => setErrorImgs(p => new Set([...p, table.id]))}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center" style={{ background: tc.grad }}>
                        <span className="text-5xl opacity-25">{tc.emoji}</span>
                      </div>
                    )}
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
                        color: tc.accent, backdropFilter: "blur(8px)",
                      }}
                    >
                      {formatCurrency(table.hourly_rate)}/hr
                    </span>
                  </div>

                  <div className="p-4 flex flex-col flex-1">
                    <h3 className="font-bold text-[16px] leading-tight capitalize mb-0.5" style={{ color: textPri }}>
                      {table.name}
                    </h3>
                    {(table.size || table.description) && (
                      <p className="text-xs mb-3 line-clamp-1" style={{ color: textMut }}>
                        {[table.size, table.description].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <div className="mt-auto">
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
            onClick={closeSheet}
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

            <div className="px-4 sm:px-5 pt-2 pb-10 max-w-lg mx-auto space-y-5">

              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-block text-xs font-bold px-2.5 py-0.5 rounded-full text-white mb-2" style={{ background: sheetType.accent }}>
                    {sheetType.emoji} {sheetType.label}{booking.size ? ` · ${booking.size}` : ""}
                  </span>
                  <h3 className="text-xl font-bold capitalize" style={{ color: textPri }}>{booking.name}</h3>
                  <p className="text-sm mt-0.5" style={{ color: textSec }}>{formatCurrency(booking.hourly_rate)}/hr</p>
                </div>
                <button className="p-2 rounded-full shrink-0" style={{ background: inputBg, color: textSec }} onClick={closeSheet}>
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Date + live selection summary */}
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
                {selectedSlots.length > 0 && (
                  <>
                    <div className="w-px h-8" style={{ background: inputBdr }} />
                    <div className="text-right">
                      <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: textMut }}>Selected</p>
                      <p className="text-sm font-semibold" style={{ color: textPri }}>
                        {fmt(selectedSlots[0])} – {fmt(slotEndTime(selectedSlots[selectedSlots.length - 1]))}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Slot grid — 3 cols, range format, selectable / occupied */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: textMut }}>
                  Select Time Slots
                </label>

                {slotsLoading ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 sm:gap-2">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-11 rounded-xl animate-pulse"
                        style={{ background: inputBg, opacity: 1 - i * 0.08 }}
                      />
                    ))}
                  </div>
                ) : allSlots.length === 0 ? (
                  <p className="text-sm text-center py-6" style={{ color: textMut }}>No slots available for this date</p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 sm:gap-2 max-h-64 sm:max-h-72 overflow-y-auto scrollbar-hide pr-1">
                    {allSlots.map(s => {
                      const serverBlocked = isServerBlocked(date, s);
                      const cartOccupied  = isCartOccupied(booking.id, date, s);
                      const selected      = selectedSlots.includes(s);
                      const hasStart      = selectedSlots.length > 0;
                      const isStartSlot   = s === selectedSlots[0];
                      // Once a start is chosen, all other slots show their END time
                      const displayTime   = (hasStart && !isStartSlot) ? fmt(slotEndTime(s)) : fmt(s);

                      // Booked by someone else — show muted, non-interactive
                      if (serverBlocked) {
                        return (
                          <div
                            key={s}
                            title="Already booked"
                            className="flex flex-col items-center justify-center py-3 rounded-xl select-none pointer-events-none gap-0.5"
                            style={{
                              background: dark ? "rgba(239,68,68,0.06)" : "rgba(239,68,68,0.05)",
                              border: `1.5px solid ${dark ? "rgba(239,68,68,0.18)" : "rgba(239,68,68,0.15)"}`,
                            }}
                          >
                            <span className="text-[11px] font-bold leading-tight line-through" style={{ color: textMut }}>
                              {displayTime}
                            </span>
                            <span className="text-[9px] leading-tight font-medium" style={{ color: "rgba(239,68,68,0.5)" }}>
                              Booked
                            </span>
                          </div>
                        );
                      }

                      // In customer's own cart
                      if (cartOccupied) {
                        return (
                          <div
                            key={s}
                            title="Already in your cart"
                            className="flex flex-col items-center justify-center py-3 rounded-xl select-none pointer-events-none gap-0.5"
                            style={{ background: "#10B981", border: "1.5px solid #059669" }}
                          >
                            <Check className="h-3 w-3 text-white" />
                            <span className="text-[10px] font-bold text-white leading-tight">{displayTime}</span>
                          </div>
                        );
                      }

                      return (
                        <button
                          key={s}
                          onClick={() => handleSlotClick(s)}
                          className="flex flex-col items-center justify-center py-3 rounded-xl transition-all active:scale-95 gap-0.5"
                          style={{
                            background: selected ? sheetType.accent : inputBg,
                            border: `1.5px solid ${selected ? sheetType.accent : inputBdr}`,
                            boxShadow: selected ? `0 4px 12px ${sheetType.accent}40` : "none",
                          }}
                        >
                          <span
                            className="text-[11px] font-bold leading-tight"
                            style={{ color: selected ? "#fff" : textPri }}
                          >
                            {displayTime}
                          </span>
                          {isStartSlot && (
                            <span className="text-[8px] font-semibold uppercase tracking-wide leading-tight" style={{ color: "rgba(255,255,255,0.65)" }}>
                              Start
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Duration + total — only when slots selected */}
              {selectedSlots.length > 0 && (
                <div
                  className="flex items-center justify-between px-4 py-3 rounded-xl"
                  style={{ background: inputBg, border: `1.5px solid ${inputBdr}` }}
                >
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: textMut }}>Duration</p>
                    <p className="text-sm font-semibold" style={{ color: textPri }}>{selLabel}</p>
                  </div>
                  <span className="text-2xl font-bold" style={{ color: sheetType.accent }}>{selTotal}</span>
                </div>
              )}

              {/* CTA */}
              <button
                className="w-full py-4 rounded-xl font-bold text-white text-base transition-all active:scale-[0.98] disabled:opacity-40"
                style={{
                  background: "#111111",
                  boxShadow: selectedSlots.length > 0 ? "0 8px 24px rgba(0,0,0,0.35)" : "none",
                }}
                disabled={selectedSlots.length === 0}
                onClick={() => addToCart(booking)}
              >
                {selectedSlots.length > 0
                  ? `Add to Cart — ${selTotal} · ${selLabel}`
                  : "Tap slots above to select"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1); // local date arithmetic, no timezone shift
  return [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, "0"),
    String(next.getDate()).padStart(2, "0"),
  ].join("-");
}
