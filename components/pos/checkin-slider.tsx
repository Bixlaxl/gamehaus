"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { X, Search, QrCode } from "lucide-react";
import type { Booking, Order } from "@/lib/supabase/types";

interface MemberInfo {
  membership_discount_pct: number;
  free_hours_ledger: Record<string, number>;
  bound_table_ids: string[];
  memberships: { plan?: { free_hrs?: number } | null }[];
}

interface CheckinSliderProps {
  locationId: string;
}

type BookingWithOrder = Booking & { order: Pick<Order, "customer_name" | "customer_phone"> };

export function CheckinSlider({ locationId }: CheckinSliderProps) {
  const checkinOpen    = usePOSStore((s) => s.checkinOpen);
  const setCheckinOpen = usePOSStore((s) => s.setCheckinOpen);
  const selectOrder    = usePOSStore((s) => s.selectOrder);
  const qc = useQueryClient();

  const [search,     setSearch]     = useState("");
  const [results,    setResults]    = useState<BookingWithOrder[]>([]);
  const [searching,  setSearching]  = useState(false);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  // member info keyed by phone — loaded lazily as results load
  const [memberMap,  setMemberMap]  = useState<Record<string, MemberInfo | null>>({});

  // Defense in depth: when staff opens the slider, force-refresh the upcoming
  // bookings cache. Realtime should keep this current, but if a booking
  // realtime event was missed (publication off, transient disconnect), this
  // ensures the table grid shows new bookings on the very next interaction.
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
    // Auto-load all today/tomorrow bookings the moment the slider opens —
    // typing then narrows the list. Previously staff had to type before
    // any results appeared which made the panel look empty/broken.
    doSearch("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-run the search whenever the text changes (debounced) so the list
  // updates live without making staff hit the search button.
  useEffect(() => {
    const t = setTimeout(() => { doSearch(search); }, 200);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function close() {
    setSearch(""); setResults([]); setError(null); setCheckinOpen(false);
  }

  async function doSearch(q: string) {
    setSearching(true); setError(null);
    const res = await fetch(
      `/api/pos/search-bookings?locationId=${encodeURIComponent(locationId)}&q=${encodeURIComponent(q.trim())}`
    );
    const body = await res.json() as
      | { success: true;  data: BookingWithOrder[] }
      | { success: false; error: string };

    if (!body.success) { setError(body.error); setSearching(false); return; }
    setResults(body.data);
    setSearching(false);

    // Load member info for all phones in results that haven't been fetched yet
    const phones = Array.from(new Set(
      body.data
        .map((b) => (b.order as { customer_phone?: string | null } | null)?.customer_phone)
        .filter((p): p is string => !!p && !(p in memberMap))
    ));
    phones.forEach(async (phone) => {
      const r = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`);
      const d = await r.json() as { found: boolean; customer: { membership_discount_pct: number; free_hours_ledger?: Record<string, number>; bound_table_ids?: string[] } | null };
      setMemberMap((prev) => ({
        ...prev,
        [phone]: d.found && d.customer ? {
          membership_discount_pct: d.customer.membership_discount_pct,
          free_hours_ledger: (d.customer as any).free_hours_ledger ?? {},
          bound_table_ids: (d.customer as any).bound_table_ids ?? [],
          memberships: (d.customer as any).memberships ?? [],
        } : null,
      }));
    });
  }

  async function checkIn(booking: BookingWithOrder) {
    setCheckingIn(booking.id); setError(null);

    const res  = await fetch(`/api/bookings/${booking.id}/checkin`, { method: "POST" });
    const body = await res.json() as
      | { success: true;  data: { order_id: string } }
      | { success: false; error: string };

    if (!body.success) { setError(body.error); setCheckingIn(null); return; }

    qc.invalidateQueries({ queryKey: ["pos-orders",   locationId] });
    qc.invalidateQueries({ queryKey: ["pos-tables",   locationId] });
    qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
    selectOrder(body.data.order_id);
    close();
    setCheckingIn(null);
  }

  if (!checkinOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/50 dark:bg-black/60" onClick={close} />
      <div className="w-96 flex flex-col bg-white dark:bg-[#111] border-l border-gray-200 dark:border-[#1F1F1F]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-[#1F1F1F]">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white text-base">Check-in</h2>
            <p className="text-xs mt-0.5 text-gray-400 dark:text-[#555]">Search by name or phone</p>
          </div>
          <button
            onClick={close}
            className="text-gray-400 dark:text-[#555] hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search bar */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100 dark:border-[#1A1A1A]">
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch(search)}
              placeholder="Name or phone..."
              className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none transition-colors
                bg-gray-100 dark:bg-[#1A1A1A]
                border border-transparent
                text-gray-900 dark:text-white
                placeholder-gray-400 dark:placeholder-[#444]
                focus:border-[#D4541A] focus:bg-white dark:focus:bg-[#111]"
              autoFocus
            />
            <button
              onClick={() => doSearch(search)}
              disabled={searching}
              className="px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-85 disabled:opacity-40
                bg-gray-900 text-white dark:bg-white dark:text-gray-900"
            >
              {searching ? "…" : <Search className="h-4 w-4" />}
            </button>
          </div>
          {error && (
            <p
              className="text-sm rounded-lg px-3 py-2 mt-3"
              style={{ background: "rgba(239,68,68,0.07)", color: "#f87171", border: "1px solid rgba(239,68,68,0.18)" }}
            >
              {error}
            </p>
          )}
        </div>

        {/* Results / empty state */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">

          {/* Empty default state — no bookings today/tomorrow at this location */}
          {!search && !searching && results.length === 0 && (
            <div className="py-12 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-[#1A1A1A] flex items-center justify-center mx-auto">
                <QrCode className="h-6 w-6 text-gray-300 dark:text-[#444]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-500 dark:text-[#666]">No bookings yet</p>
                <p className="text-xs text-gray-300 dark:text-[#444] mt-1">
                  Today and tomorrow are clear at this location
                </p>
              </div>
            </div>
          )}

          {/* No results after search */}
          {results.length === 0 && search && !searching && (
            <div className="py-10 text-center space-y-1">
              <p className="text-sm font-medium text-gray-400 dark:text-[#555]">No bookings found</p>
              <p className="text-xs text-gray-300 dark:text-[#333]">Try a different name or number</p>
            </div>
          )}

          {/* Results */}
          {results.map((booking) => {
            const phone = (booking.order as { customer_phone?: string | null } | null)?.customer_phone ?? null;
            const memberInfo = phone ? (memberMap[phone] ?? null) : null;
            const memberPct = memberInfo?.membership_discount_pct ?? 0;
            const hasFreeHrs = Object.values(memberInfo?.free_hours_ledger ?? {}).some((v) => v > 0);
            return (
              <div
                key={booking.id}
                className="rounded-xl p-4 bg-white dark:bg-[#111] border border-gray-200 dark:border-[#2A2A2A]"
                style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 dark:text-white text-sm">{booking.order?.customer_name}</p>
                    {booking.order?.customer_phone && (
                      <p className="text-xs mt-0.5 text-gray-400 dark:text-[#555]">{booking.order.customer_phone}</p>
                    )}
                    <p className="text-xs font-mono font-semibold mt-1.5 tabular-nums" style={{ color: "#f59e0b" }}>
                      {new Date(booking.scheduled_start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      {" → "}
                      {new Date(booking.scheduled_end).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    {/* Membership preview */}
                    {memberPct > 0 && (
                      <p className="text-xs font-semibold mt-1.5" style={{ color: "#a78bfa" }}>
                        Member — {memberPct}% off
                      </p>
                    )}
                    {hasFreeHrs && (
                      <p className="text-xs font-semibold mt-0.5" style={{ color: "#a78bfa" }}>
                        Free hrs available
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => checkIn(booking)}
                    disabled={checkingIn === booking.id}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-85 disabled:opacity-40"
                    style={{ background: "#10b981" }}
                  >
                    {checkingIn === booking.id ? "…" : "Check In"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
