"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
import { formatCurrency, isSimulatorActive, getActualSlotDate } from "@/lib/utils";



import { createClient } from "@/lib/supabase/client";
import type { Location, Table, TableMode } from "@/lib/supabase/types";
import { ShoppingCart, ArrowLeft, X, ChevronRight, Check, Calendar } from "lucide-react";
import { useTheme } from "next-themes";

/* ── Type config ─────────────────────────── */
const TYPE: Record<string, { label: string; emoji: string; accent: string; grad: string }> = {
  snooker:       { label: "Snooker",       emoji: "🎱", accent: "#D4541A", grad: "linear-gradient(135deg,#D4541A 0%,#7A2508 100%)" },
  pool:          { label: "Pool",          emoji: "🎱", accent: "#1E6B4A", grad: "linear-gradient(135deg,#1E6B4A 0%,#0B3324 100%)" },
  ps5:           { label: "PS5",           emoji: "🎮", accent: "#6D28D9", grad: "linear-gradient(135deg,#6D28D9 0%,#3B0D8E 100%)" },
  ps5_simulator: { label: "PS5 & Sim",    emoji: "🎮", accent: "#6D28D9", grad: "linear-gradient(135deg,#6D28D9 0%,#3B0D8E 100%)" },
  foosball:      { label: "Foosball",      emoji: "⚽", accent: "#B45309", grad: "linear-gradient(135deg,#B45309 0%,#6B3203 100%)" },
};
function cfg(type: string) {
  return TYPE[type] ?? { label: type, emoji: "🎯", accent: "#555", grad: "linear-gradient(135deg,#444,#222)" };
}

/* ── Helpers ─────────────────────────────── */
function getLocalDateString(timezone: string = "Asia/Kolkata", dateInput: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dateInput);
  } catch (e) {
    return new Date(dateInput.getTime() - dateInput.getTimezoneOffset() * 60_000).toISOString().split("T")[0];
  }
}

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
  return `${hr}:${String(m).padStart(2, "0")} ${ap}`;
}
function fmtRange(startStr: string, endStr: string): string {
  const [sh, sm] = startStr.split(":").map(Number);
  const [eh, em] = endStr.split(":").map(Number);
  const sAp = sh >= 12 ? "PM" : "AM";
  const eAp = eh >= 12 ? "PM" : "AM";
  const sHr = sh % 12 || 12;
  const eHr = eh % 12 || 12;

  const sMin = `:${String(sm).padStart(2, "0")}`;
  const eMin = `:${String(em).padStart(2, "0")}`;

  if (sAp === eAp) {
    return `${sHr}${sMin} – ${eHr}${eMin} ${eAp}`;
  }
  return `${sHr}${sMin} ${sAp} – ${eHr}${eMin} ${eAp}`;
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
function visibleSlots(opening: string, closing: string, dateStr: string, timezone: string): string[] {
  const [oh, om] = opening.split(":").map(Number);
  const [ch, cm] = closing.split(":").map(Number);
  const openMins  = oh * 60 + om;
  const closeMins = ch * 60 + cm;
  let end = closeMins - 15;
  const crossesMidnight = end < openMins;
  if (crossesMidnight) end += 24 * 60;

  const today = getLocalDateString(timezone);
  const filterByTime = dateStr === today;
  const now    = new Date();
  const curRaw = now.getHours() * 60 + now.getMinutes();
  // Round up to next 15-min boundary so we never show a slot that's already started
  const curRounded = Math.ceil(curRaw / 15) * 15;

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
function buildDays(timezone: string) {
  const days = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    days.push({
      iso: getLocalDateString(timezone, d),
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }),
    });
  }
  return days;
}

/* ── Component ───────────────────────────── */
interface Props {
  location: Location;
  tables: Table[];
  initialSlots?: Record<string, { start: string; end: string }[]>;
  initialDate?: string;
}

export function LocationBrowse({ location, tables, initialSlots, initialDate }: Props) {
  const cart = useCartStore();
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted]         = useState(false);
  const [filter, setFilter]           = useState("all");
  const [date, setDate]               = useState(() => getLocalDateString(location.timezone));
  const [booking, setBooking]         = useState<Table | null>(null);
  const [selectedSlots, setSelected]  = useState<string[]>([]);
  const [step, setStep]               = useState<"mode" | "when" | "players">("mode");
  const [selectedMode, setSelectedMode] = useState<TableMode | null>(null);
  const [numPeople, setNumPeople]     = useState<string | null>(null); // key into people_pricing
  const [errorImgs, setErrorImgs]     = useState<Set<string>>(new Set());
  const [blockedRanges, setBlocked]   = useState<{ start: string; end: string }[]>([]);
  const [otherConsoleBlocked, setOtherConsoleBlocked] = useState<{ start: string; end: string }[]>([]);
  const [slotsLoading,  setSlotsLoading] = useState(false);
  // Bump this whenever a realtime DB event invalidates the slot data.
  // Used as a dependency on the slot-loading effect so the next fetch is forced.
  const [slotsTick, setSlotsTick]     = useState(0);
  const tableIdsKey = useMemo(() => tables.map((t) => t.id).sort().join(","), [tables]);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { cart.setLocation(location.id); }, [location.id]);

  // Bust Next.js router cache on mount and whenever the user comes back to the
  // tab. router.refresh() re-runs the server component so initialSlots gets
  // fresh props. We do NOT bump slotsTick here — the slot-loading effect uses
  // SWR (show cached instantly, refetch in background), so even if initialSlots
  // is briefly stale from the router cache, the user sees something immediately
  // and gets the fresh data on the next tick.
  useEffect(() => {
    router.refresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Realtime: keep slot data in lockstep with the staff side ───────────────
  // The moment a walk-in is started or a booking is created/changed for any of
  // this location's tables, increment slotsTick. The slot-loading effect below
  // depends on slotsTick, so the currently-open sheet will refetch immediately
  // and any subsequently-opened sheet bypasses the stale initialSlots cache.
  useEffect(() => {
    if (!tables.length) return;
    const supabase = createClient();
    const tableIdSet = new Set(tables.map((t) => t.id));

    const channel = supabase
      .channel(`public-slots-${location.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { table_id?: string } | null;
          if (row?.table_id && tableIdSet.has(row.table_id)) setSlotsTick((t) => t + 1);
        })
      .on("postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        // bookings don't carry table_id directly — refresh on any change since
        // affected rows are small per-location and the cost is one extra fetch.
        () => setSlotsTick((t) => t + 1))
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [location.id, tableIdsKey]);

  // Stale-while-revalidate: show cached slots INSTANTLY (zero perceived
  // latency on table tap), then fetch fresh in the background to catch any
  // changes that happened since the page was rendered. Loading skeleton only
  // appears when we genuinely have no cached data.
  useEffect(() => {
    if (!booking) return;

    const cached = initialSlots && initialDate && date === initialDate && booking.id in initialSlots
      ? initialSlots[booking.id]
      : null;

    if (cached !== null) {
      setBlocked(cached);
    } else {
      setBlocked([]);
      setSlotsLoading(true);
    }

    // Background revalidation. Cancellable so a fast newer fetch isn't
    // overwritten by a slow older one when the user changes date/table quickly.
    let cancelled = false;
    fetch(`/api/tables/${booking.id}/slots?date=${date}`)
      .then((r) => r.json())
      .then((body: { success: boolean; data: { start: string; end: string }[] }) => {
        if (cancelled || !body.success) return;
        setBlocked(body.data);
        const otherBlocked = (body as any).otherConsoleBlocked ?? [];
        setOtherConsoleBlocked(otherBlocked);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSlotsLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, booking?.id, slotsTick]);

  const dark      = false;
  const open      = isOpen(location.opening_time, location.closing_time);
  const types     = ["all", ...new Set(tables.map(t => t.type))];
  const shown     = filter === "all" ? tables : tables.filter(t => t.type === filter);
  const days      = useMemo(() => buildDays(location.timezone), [location.timezone]);
  const cartCount = cart.items.length;

  /* All slots for the current sheet date */
  const allSlots = booking
    ? visibleSlots(location.opening_time, location.closing_time, date, location.timezone)
    : [];

  /* People/controller pricing options for the current booking */
  const pricingOptions = useMemo(() => {
    if (!booking) return [];
    if (booking.modes && booking.modes.length > 0) {
      if (!selectedMode || !selectedMode.people_pricing) return [];
      return Object.keys(selectedMode.people_pricing)
        .filter((k) => Boolean(selectedMode.people_pricing![k]))
        .sort((a, b) => Number(a) - Number(b));
    }
    if (!booking.people_pricing) return [];
    return Object.keys(booking.people_pricing).sort((a, b) => Number(a) - Number(b));
  }, [booking, selectedMode]);


  /* Effective hourly rate — uses people_pricing if a count is selected, else flat rate */
  const effectiveRate = (() => {
    if (!booking) return 0;
    if (booking.modes && booking.modes.length > 0) {
      if (!selectedMode) return booking.hourly_rate;
      if (numPeople && selectedMode.people_pricing && selectedMode.people_pricing[numPeople]) {
        return selectedMode.people_pricing[numPeople] as number;
      }
      return selectedMode.hourly_rate;
    }
    if (numPeople && booking.people_pricing && booking.people_pricing[numPeople]) {
      return booking.people_pricing[numPeople] as number;
    }
    return booking.hourly_rate;
  })();

  const isOtherConsoleOccupied = useMemo(() => {
    return false;
  }, []);

  /* Derived totals from slot selection */
  const selMins  = selectedSlots.length * 15;
  const selLabel = selMins === 0 ? "" : selMins >= 60
    ? `${Math.floor(selMins / 60)}h${selMins % 60 ? ` ${selMins % 60}m` : ""}`
    : `${selMins}m`;
  const selTotal = (booking && selMins > 0)
    ? formatCurrency((selMins / 60) * effectiveRate)
    : "";

  // ── Hot-path memoization for the slot grid ─────────────────────────────────
  const blockedRangesMs = useMemo(
    () => blockedRanges.map(r => ({
      start: new Date(r.start).getTime(),
      end:   new Date(r.end).getTime(),
    })),
    [blockedRanges]
  );
  const cartItemsMs = useMemo(
    () => cart.items.map(i => ({
      tableId: i.tableId,
      tableName: i.tableName,
      tableType: i.tableType,
      numPeople: i.numPeople ?? 1,
      startMs: new Date(i.scheduledStart).getTime(),
      endMs:   new Date(i.scheduledEnd).getTime(),
    })),
    [cart.items]
  );

  /* Slot is in customer's own cart (show blue occupied card) */
  function isCartOccupied(tableId: string, slotDate: string, slotTime: string): boolean {
    const actualDate = getActualSlotDate(slotDate, slotTime, location.opening_time, location.closing_time);
    const slotMs = new Date(`${actualDate}T${slotTime}:00`).getTime();
    // Per-table check — a slot in the cart for this same table blocks it
    return cartItemsMs.some(item => item.tableId === tableId && slotMs >= item.startMs && slotMs < item.endMs);
  }




  /* Slot is blocked by a walk-in or confirmed booking on the server — hide it entirely */
  function isServerBlocked(slotDate: string, slotTime: string): boolean {
    const actualDate = getActualSlotDate(slotDate, slotTime, location.opening_time, location.closing_time);
    const slotMs = new Date(`${actualDate}T${slotTime}:00`).getTime();
    return blockedRangesMs.some(r => slotMs >= r.start && slotMs < r.end);
  }

  /* Combined — used for extend-stop logic */
  function isOccupied(tableId: string, slotDate: string, slotTime: string): boolean {
    return isCartOccupied(tableId, slotDate, slotTime) || isServerBlocked(slotDate, slotTime);
  }

  function openSheet(table: Table) {
    setBooking(table);
    setSelected([]);
    setSelectedMode(null);
    setNumPeople(null);
    if (table.modes && table.modes.length > 0) {
      setStep("mode");
    } else {
      setStep("when");
      const keys = table.people_pricing ? Object.keys(table.people_pricing).sort((a, b) => Number(a) - Number(b)) : [];
      setNumPeople(keys[0] ?? null);
    }
  }

  function closeSheet() {
    setBooking(null);
    setSelected([]);
    setNumPeople(null);
    setSelectedMode(null);
    setBlocked([]);
    setOtherConsoleBlocked([]);
    setSlotsLoading(false);
    setStep("mode");
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
    const isSim = isSimulatorActive(t, selectedMode);
    const requiredSlots = isSim ? 1 : 2; // Simulators = 15m (1 slot), all other tables = 30m (2 slots)
    if (selectedSlots.length < requiredSlots) return;
    const firstSlot = selectedSlots[0];
    const lastSlot  = selectedSlots[selectedSlots.length - 1];
    console.log("[addToCart] date:", date, "firstSlot:", firstSlot, "lastSlot:", lastSlot);
    console.log("[addToCart] location.opening_time:", location.opening_time, "location.closing_time:", location.closing_time);
    const slotStartDate = getActualSlotDate(date, firstSlot, location.opening_time, location.closing_time);
    console.log("[addToCart] slotStartDate:", slotStartDate);
    const startIso  = new Date(`${slotStartDate}T${firstSlot}:00`).toISOString();
    console.log("[addToCart] startIso:", startIso);
    const endStr    = slotEndTime(lastSlot);
    const endDate   = endStr < firstSlot ? addOneDay(slotStartDate) : slotStartDate;
    const endIso    = new Date(`${endDate}T${endStr}:00`).toISOString();
    const durationMins = selectedSlots.length * 15;

    if (cart.items.some(i => i.tableId === t.id && i.scheduledStart === startIso)) {
      closeSheet();
      return;
    }

    let rate: number = effectiveRate;
    let finalNumPeople: number | undefined = numPeople ? Number(numPeople) : undefined;

    cart.addItem({
      tableId: t.id, tableName: t.name, tableType: t.type,
      selectedModeId: selectedMode?.id,
      selectedModeName: selectedMode?.name,
      ratePerHour: rate,
      numPeople: finalNumPeople,
      scheduledStart: startIso, scheduledEnd: endIso,
      durationMins, amount: (durationMins / 60) * rate,
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
  const isSim     = isSimulatorActive(booking, selectedMode);
  const minSlots  = isSim ? 1 : 2;

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
            const tc     = t === "all" ? null : cfg(t);
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
                      <Image
                        src={table.image_url} alt={table.name}
                        fill
                        className="object-cover"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
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
                      {(() => {
                        const pp = table.people_pricing;
                        if (pp && Object.keys(pp).length > 0) {
                          const rates = Object.values(pp).sort((a, b) => a - b);
                          const lo = rates[0];
                          const hi = rates[rates.length - 1];
                          return lo === hi
                            ? `${formatCurrency(lo)}/hr`
                            : `${formatCurrency(lo)}–${formatCurrency(hi)}/hr`;
                        }
                        if (table.type === "ps5" && table.name.toLowerCase().includes("simulator")) {
                          return `${formatCurrency(table.hourly_rate)}–${formatCurrency(table.hourly_rate * 2)}/hr`;
                        }
                        return `${formatCurrency(table.hourly_rate)}/hr`;
                      })()}
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

            <div className="px-4 sm:px-5 pt-2 pb-28 max-w-lg mx-auto space-y-4">

              {(() => {
                const hasPricing = pricingOptions.length > 0;
                const onMode     = step === "mode";
                const onWhen     = step === "when";
                const stopLabel  = (() => {
                  if (selectedSlots.length === 0) return "";
                  const last = selectedSlots[selectedSlots.length - 1];
                  return fmt(slotEndTime(last));
                })();
                const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("en-IN", {
                  weekday: "short", day: "numeric", month: "short",
                }).toUpperCase();
                const isToday   = date === getLocalDateString(location.timezone);

                const startBg  = "#10B981";
                const stopBg   = "#EF4444";
                const middleBg = dark ? "rgba(16, 185, 129, 0.15)" : "rgba(16, 185, 129, 0.08)";
                const hasModes = Boolean(booking.modes && booking.modes.length > 0);

                return (
                  <>
                    {/* ── Header ── */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        {(!onWhen && !onMode) && (
                          <button
                            onClick={() => setStep("when")}
                            className="p-2 rounded-full shrink-0 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-800"
                            style={{ background: inputBg, color: textSec }}
                            aria-label="Back"
                          >
                            <ArrowLeft className="h-4 w-4" />
                          </button>
                        )}
                        {!onMode && hasModes && step === "when" && (
                          <button
                            onClick={() => { setStep("mode"); setSelected([]); setSelectedMode(null); }}
                            className="p-2 rounded-full shrink-0 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-800"
                            style={{ background: inputBg, color: textSec }}
                            aria-label="Back to mode"
                          >
                            <ArrowLeft className="h-4 w-4" />
                          </button>
                        )}
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full text-purple-700 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-300">
                              {sheetType.emoji} {sheetType.label}{booking.size ? ` · ${booking.size}` : ""}
                            </span>
                          </div>
                          <h3 className="text-2xl font-extrabold capitalize text-gray-900 dark:text-white tracking-tight">{booking.name}</h3>
                          {hasModes && selectedMode && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-purple-600 text-white shadow-xs">
                              {selectedMode.icon || "🎯"} {selectedMode.name} Mode
                            </span>
                          )}
                        </div>
                      </div>
                      <button className="p-2 rounded-full shrink-0 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-800" style={{ background: inputBg, color: textSec }} onClick={closeSheet}>
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* ── Stepper ── */}
                    {hasPricing && !onMode && (
                      <div className="flex items-center gap-3 pt-1">
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${onWhen ? "bg-purple-600 text-white" : "bg-gray-200 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                            1
                          </span>
                          <span className={`text-xs font-bold ${onWhen ? "text-purple-600 dark:text-purple-400" : "text-gray-400"}`}>
                            Timing
                          </span>
                        </div>
                        <div className="flex-1 h-[2px] bg-gray-200 dark:bg-zinc-800 overflow-hidden rounded-full flex">
                          <div className={`h-full transition-all duration-300 ${onWhen ? "w-1/2 bg-purple-600" : "w-full bg-purple-600"}`} />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${!onWhen ? "bg-purple-600 text-white" : "bg-gray-200 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                            2
                          </span>
                          <span className={`text-xs font-semibold ${!onWhen ? "text-purple-600 dark:text-purple-400" : "text-gray-400"}`}>
                            {selectedMode?.pricing_basis === "controller" || (!hasModes && booking.type === "ps5") ? "Controllers" : "Players"}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* ╔══ STEP 0 — MODE SELECTION ══╗ */}
                    {onMode && hasModes && (
                      <div className="space-y-3 pt-2">
                        <p className="text-sm font-medium" style={{ color: textSec }}>Select Game Mode for {booking.name}:</p>
                        <div className="grid grid-cols-2 gap-3">
                          {booking.modes!.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => {
                                setSelectedMode(m);
                                setStep("when");
                                const keys = m.people_pricing ? Object.keys(m.people_pricing).filter(k => Boolean(m.people_pricing![k])).sort((a,b) => Number(a)-Number(b)) : [];
                                setNumPeople(keys[0] ?? null);
                              }}
                              className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all active:scale-95 text-center"
                              style={{ background: inputBg, borderColor: sheetType.accent, boxShadow: `0 4px 16px ${sheetType.accent}20` }}
                            >
                              <span className="text-3xl">{m.icon || "🎯"}</span>
                              <div>
                                <p className="font-bold text-sm" style={{ color: textPri }}>{m.name}</p>
                                <p className="text-xs mt-0.5 font-medium" style={{ color: textSec }}>
                                  {formatCurrency(m.hourly_rate)}/hr
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ╔═════════════════════════════ STEP 1 — WHEN ═════════════════════════════╗ */}
                    {onWhen && (
                      <>
                        {/* Instructional hint */}
                        {selectedSlots.length === 0 ? (
                          <p className="text-xs font-medium text-gray-500 dark:text-zinc-400">
                            Tap a start time, then a finish time.
                          </p>
                        ) : selectedSlots.length === 1 ? (
                          <p className="text-xs font-medium text-gray-500 dark:text-zinc-400">
                            Start <span className="font-bold text-gray-900 dark:text-white">{fmt(selectedSlots[0])}</span>. Now pick a <span className="font-bold text-gray-900 dark:text-white">finish time</span>.
                          </p>
                        ) : (
                          <p className="text-xs font-medium text-gray-500 dark:text-zinc-400">
                            Booked <span className="font-bold text-gray-900 dark:text-white">{fmt(selectedSlots[0])} → {stopLabel}</span>. Tap again to change.
                          </p>
                        )}

                        {/* Date + Legend card */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-2xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 shadow-xs">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-950/50 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
                              <Calendar className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-gray-900 dark:text-white leading-tight">{dateLabel}</p>
                              <p className="text-[10px] text-gray-400 dark:text-zinc-500 font-medium leading-tight">{isToday ? "Today" : ""}</p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 text-[10px] font-bold text-gray-600 dark:text-zinc-400 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-zinc-800">
                            <span className="inline-flex items-center gap-1">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ background: startBg }} />
                              Start
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ background: stopBg }} />
                              Stop
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#4F46E5" }} />
                              In cart
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="w-2.5 h-2.5 rounded-xs" style={{
                                background: `repeating-linear-gradient(45deg, ${inputBdr}, ${inputBdr} 2px, transparent 2px, transparent 4px)`,
                              }} />
                              Booked
                            </span>
                          </div>
                        </div>

                        {/* Slot grid */}
                        {slotsLoading ? (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-2.5">
                            {Array.from({ length: 8 }).map((_, i) => (
                              <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: inputBg, opacity: 1 - i * 0.08 }} />
                            ))}
                          </div>
                        ) : allSlots.length === 0 ? (
                          <p className="text-sm text-center py-6" style={{ color: textMut }}>No slots available for this date</p>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-2.5">
                            {allSlots.map(s => {
                              const serverBlocked = isServerBlocked(date, s);
                              const cartOccupied  = isCartOccupied(booking.id, date, s);
                              const selected      = selectedSlots.includes(s);
                              const isStartSlot   = selectedSlots.length > 0 && s === selectedSlots[0];
                              const isStopSlot    = selectedSlots.length > 1 && s === selectedSlots[selectedSlots.length - 1];
                              const isInterior    = selected && !isStartSlot && !isStopSlot;
                              const hasStart      = selectedSlots.length > 0;
                              const display       = isSim
                                ? fmtRange(s, slotEndTime(s))
                                : (hasStart && !isStartSlot) ? fmt(slotEndTime(s)) : fmt(s);

                              // Booked elsewhere — hatched, non-interactive
                              if (serverBlocked) {
                                return (
                                  <div
                                    key={s}
                                    title="Already booked"
                                    className="relative flex items-center justify-center py-3 rounded-xl select-none pointer-events-none overflow-hidden"
                                    style={{
                                      background: inputBg,
                                      border: `1.5px solid ${inputBdr}`,
                                      backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 5px, ${dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)"} 5px, ${dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)"} 10px)`,
                                    }}
                                  >
                                    <span className="text-[11px] font-bold leading-tight line-through" style={{ color: textMut }}>
                                      {display}
                                    </span>
                                  </div>
                                );
                              }

                              // In customer's own cart — blue check
                              if (cartOccupied) {
                                return (
                                  <div
                                    key={s}
                                    title="Already in your cart"
                                    className="flex flex-col items-center justify-center py-3 rounded-xl select-none pointer-events-none gap-0.5"
                                    style={{ background: "#4F46E5", border: "1.5px solid #3730A3" }}
                                  >
                                    <Check className="h-3 w-3 text-white" />
                                    <span className="text-[10px] font-bold text-white leading-tight">{display}</span>
                                  </div>
                                );
                              }

                              const bg = isStartSlot ? startBg : isStopSlot ? stopBg : isInterior ? middleBg : (dark ? "#18181b" : "#ffffff");
                              const borderColor = isStartSlot ? startBg : isStopSlot ? stopBg : isInterior ? (dark ? "rgba(16, 185, 129, 0.4)" : "rgba(16, 185, 129, 0.25)") : (dark ? "#27272a" : "#f1f5f9");
                              const fg = (isStartSlot || isStopSlot) ? "#ffffff" : (dark ? "#f4f4f5" : "#09090b");
                              const labelText = isStartSlot ? "START" : isStopSlot ? "STOP" : "";

                              return (
                                <button
                                  key={s}
                                  onClick={() => handleSlotClick(s)}
                                  className="relative flex flex-col items-center justify-center py-3.5 rounded-2xl transition-all active:scale-[0.97] shadow-2xs"
                                  style={{
                                    background: bg,
                                    border: `1.5px solid ${borderColor}`,
                                    boxShadow: (isStartSlot || isStopSlot) ? `0 6px 16px ${bg}44` : undefined,
                                  }}
                                >
                                  {labelText && (
                                    <span className="text-[9px] font-extrabold tracking-widest leading-none mb-0.5" style={{ color: "rgba(255,255,255,0.95)" }}>
                                      {labelText}
                                    </span>
                                  )}
                                  <span className="text-[13px] font-bold tabular-nums leading-tight tracking-tight" style={{ color: fg }}>
                                    {display}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}

                    {/* ╔═══════════════════════════ STEP 2 — PLAYERS / CONTROLLERS ═══════════════════════════╗ */}
                    {!onWhen && hasPricing && (() => {
                      const hasModes = Boolean(booking.modes && booking.modes.length > 0);
                      let pricingBasis: "controller" | "player" | "none" = "player";
                      let activePeoplePricing: Record<string, number> | null = null;
                      let baseHourlyRate = booking.hourly_rate;

                      if (hasModes && selectedMode) {
                        pricingBasis = selectedMode.pricing_basis ?? "none";
                        activePeoplePricing = selectedMode.people_pricing ?? null;
                        baseHourlyRate = selectedMode.hourly_rate;
                      } else {
                        activePeoplePricing = booking.people_pricing ?? null;
                        if (activePeoplePricing) {
                          if (activePeoplePricing["1"] !== undefined) pricingBasis = "controller";
                          else pricingBasis = "player";
                        } else if (booking.type === "ps5") {
                          pricingBasis = "controller";
                        }
                      }

                      const isController = pricingBasis === "controller";

                      return (
                        <>
                          {/* Time recap pill — taps back to step 1 to edit */}
                          <button
                            onClick={() => setStep("when")}
                            className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl transition-colors text-left"
                            style={{
                              background: dark ? "rgba(16,185,129,0.10)" : "rgba(16,185,129,0.08)",
                              border:     `1.5px solid ${dark ? "rgba(16,185,129,0.25)" : "rgba(16,185,129,0.30)"}`,
                            }}
                          >
                            <Check className="h-4 w-4 shrink-0" style={{ color: "#10B981" }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-base font-bold tabular-nums" style={{ color: textPri }}>
                                {fmt(selectedSlots[0])} – {stopLabel}
                              </p>
                              <p className="text-xs" style={{ color: textSec }}>
                                {selLabel} · tap to change
                              </p>
                            </div>
                            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#10B981" }}>Edit</span>
                          </button>

                          <div>
                            <h4 className="text-2xl font-bold leading-tight" style={{ color: textPri }}>
                              {isController ? "Select Controllers" : "How many are playing?"}
                            </h4>
                            <p className="text-sm mt-1" style={{ color: textSec }}>
                              {isController
                                ? "Choose controller count for your gaming session."
                                : "Priced per head. We set the table for your group."}
                            </p>
                          </div>

                          <div className="space-y-2">
                            {pricingOptions.map((n, idx) => {
                              const num = Number(n);
                              let active = numPeople === n;
                              let circleText = n;

                              let noun = isController
                                ? (n === "1" ? "controller" : "controllers")
                                : (n === "1" ? "player" : "players");
                              let heading = isController ? `${n} ${noun}` : noun;
                              let sub = isController
                                ? `${n} controller${n === "1" ? "" : "s"} ready`
                                : `${n} cues & full rack set out`;

                              if (idx === 0 && num > 1 && !isController) {
                                circleText = `1-${n}`;
                                active = numPeople !== null && Number(numPeople) <= num;
                                heading = `1-${n} players`;
                                sub = `1-${n} cues & full rack set out`;
                              }

                              const rate  = activePeoplePricing?.[n] ?? baseHourlyRate;
                              const total = formatCurrency((selMins / 60) * rate);
                              return (
                                <button
                                  key={n}
                                  onClick={() => setNumPeople(n)}
                                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-left"
                                  style={{
                                    background: active ? sheetType.accent : inputBg,
                                    border:     `1.5px solid ${active ? sheetType.accent : inputBdr}`,
                                    boxShadow:  active ? `0 6px 18px ${sheetType.accent}40` : "none",
                                    cursor:     "pointer",
                                  }}
                                >
                                  <div
                                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-sm"
                                    style={{
                                      background: active ? "rgba(255,255,255,0.20)" : surface,
                                      color:      active ? "#fff" : textPri,
                                      border:     active ? "none" : `1.5px solid ${inputBdr}`,
                                    }}
                                  >
                                    {circleText}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold leading-tight" style={{ color: active ? "#fff" : textPri }}>
                                      {heading}
                                    </p>
                                    <p className="text-[11px] mt-0.5" style={{ color: active ? "rgba(255,255,255,0.85)" : textSec }}>
                                      {sub}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-base font-bold tabular-nums" style={{ color: active ? "#fff" : textPri }}>
                                      {total}
                                    </p>
                                    <p className="text-[10px] tabular-nums" style={{ color: active ? "rgba(255,255,255,0.75)" : textMut }}>
                                      ₹{rate}/hr
                                    </p>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </>
                );
              })()}
            </div>

            {/* ── Sticky footer (changes per step) ── */}
            <div
              className="sticky bottom-0 left-0 right-0 px-4 sm:px-5 py-3 flex items-center gap-3"
              style={{
                background: surface,
                borderTop: `1px solid ${inputBdr}`,
                boxShadow: "0 -8px 24px rgba(0,0,0,0.04)",
              }}
            >
              {step === "when" ? (
                <>
                  <div className="flex-1 min-w-0">
                    {selectedSlots.length >= minSlots ? (
                      <>
                        <p className="text-sm font-extrabold text-gray-900 dark:text-white tabular-nums">
                          {fmt(selectedSlots[0])} – {fmt(slotEndTime(selectedSlots[selectedSlots.length - 1]))}
                        </p>
                        <p className="text-[11px] font-semibold text-gray-400 dark:text-zinc-500 mt-0.5">
                          {selLabel} booked
                        </p>
                      </>
                    ) : selectedSlots.length === 1 && !isSim ? (
                      <p className="text-xs font-semibold text-gray-500 dark:text-zinc-400">Pick finish time (min 30m required)</p>
                    ) : (
                      <p className="text-xs font-semibold text-gray-500 dark:text-zinc-400">Pick a start time</p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (pricingOptions.length > 0) setStep("players");
                      else addToCart(booking);
                    }}
                    disabled={selectedSlots.length < minSlots}
                    className="px-6 py-3.5 rounded-2xl font-bold text-white text-sm sm:text-base transition-all active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1.5 shadow-md"
                    style={{ background: "#6366f1" }}
                  >
                    {pricingOptions.length > 0 ? "Confirm time" : `Add to cart — ${selTotal}`}
                    <ChevronRight className="h-4 w-4 stroke-[3]" />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => addToCart(booking)}
                  className="w-full px-5 py-3.5 rounded-xl font-bold text-white text-sm sm:text-base transition-all active:scale-[0.98] flex items-center justify-between gap-3"
                  style={{
                    background: sheetType.accent,
                    boxShadow:  `0 8px 24px ${sheetType.accent}55`,
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ShoppingCart className="h-4 w-4 shrink-0" />
                    <span className="truncate">Add to Cart</span>
                  </div>
                  <span className="tabular-nums shrink-0 font-extrabold text-sm sm:text-base">{selTotal || formatCurrency(0)}</span>
                </button>
              )}
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

