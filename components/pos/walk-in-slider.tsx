"use client";

import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { useNowSampled } from "@/hooks/use-now-sampled";
import { NameMismatchModal } from "./name-mismatch-modal";
import { X, Star } from "lucide-react";
import { getShopWindow } from "@/lib/utils";
import type { Table } from "@/lib/supabase/types";
import { formatCurrency, isSimulatorActive } from "@/lib/utils";

interface CustomerLookup {
  name: string | null;
  points_balance: number;
  visit_count: number;
  membership_discount_pct?: number;
  active_memberships?: any[];
}

interface WalkInSliderProps {
  locationId: string;
}

const DURATION_PRESETS = [
  { label: "30m",  mins: 30  },
  { label: "1h",   mins: 60  },
  { label: "1.5h", mins: 90  },
  { label: "2h",   mins: 120 },
];

export function WalkInSlider({ locationId }: WalkInSliderProps) {
  const walkInOpen = usePOSStore((s) => s.walkInOpen);
  if (!walkInOpen) return null;
  return <WalkInSliderInner locationId={locationId} />;
}

function WalkInSliderInner({ locationId }: WalkInSliderProps) {
  const walkInPrefilledTableId = usePOSStore((s) => s.walkInPrefilledTableId);
  const setWalkInOpen          = usePOSStore((s) => s.setWalkInOpen);
  const tables                 = usePOSStore((s) => s.tables);
  // Walk-in slider uses `now` only for the shop-window check and to derive
  // session end-time. Per-second precision would re-render the whole form
  // (autocomplete + multi-select tables) every tick. 30s sampling is plenty.
  const now                    = useNowSampled(30_000);
  const openingTime            = usePOSStore((s) => s.openingTime);
  const closingTime            = usePOSStore((s) => s.closingTime);
  const { beforeOpen, outsideHours } = getShopWindow(now, openingTime, closingTime);
  const qc = useQueryClient();

  const [customerName,     setCustomerName]     = useState("");
  const [customerPhone,    setCustomerPhone]     = useState("");
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [selectedModes,    setSelectedModes]    = useState<Record<string, string>>({});
  const [durations,        setDurations]        = useState<Record<string, number>>({});
  const [loading,          setLoading]          = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [customer,         setCustomer]         = useState<CustomerLookup | null>(null);
  const [lookingUp,        setLookingUp]        = useState(false);
  const [nameMismatch,     setNameMismatch]     = useState<{ existing: string; entered: string } | null>(null);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const idleTables = tables.filter((t) => !t.activeOrderItem);

  function bookingConflict(tableId: string): string | null {
    const table = idleTables.find((t) => t.id === tableId);
    if (!table?.upcomingBooking) return null;
    const dur          = durations[tableId] ?? 60;
    const sessionEnd   = now.getTime() + dur * 60 * 1000;
    const bookingStart = new Date(table.upcomingBooking.scheduled_start).getTime();
    if (sessionEnd > bookingStart) {
      const t = new Date(table.upcomingBooking.scheduled_start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      return `Conflicts with booking at ${t}`;
    }
    return null;
  }

  useEffect(() => {
    if (walkInPrefilledTableId) {
      setSelectedTableIds([walkInPrefilledTableId]);
      setDurations({ [walkInPrefilledTableId]: 60 });
      const table = tables.find(t => t.id === walkInPrefilledTableId);
      if (table?.modes && Array.isArray(table.modes) && table.modes.length > 0) {
        setSelectedModes({ [walkInPrefilledTableId]: table.modes[0].id });
      }
    }
  }, [walkInPrefilledTableId, tables]);

  function handlePhoneChange(val: string) {
    setCustomerPhone(val);
    setCustomer(null);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (val.trim().length >= 6) {
      setLookingUp(true);
      lookupTimer.current = setTimeout(async () => {
        const res  = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(val.trim())}`);
        const data = await res.json() as { found: boolean; customer: CustomerLookup | null };
        setCustomer(data.customer);
        if (data.found && data.customer?.name && !customerName.trim()) setCustomerName(data.customer.name);
        setLookingUp(false);
      }, 600);
    } else {
      setLookingUp(false);
    }
  }

  function reset() {
    setCustomerName(""); setCustomerPhone(""); setSelectedTableIds([]); setSelectedModes({});
    setDurations({}); setError(null); setCustomer(null); setLookingUp(false);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
  }

  function close() { reset(); setWalkInOpen(false); usePOSStore.setState({ walkInPrefilledTableId: null }); }

  function toggleTable(id: string) {
    const table = tables.find(t => t.id === id);
    const hasModes = Boolean(table?.modes && Array.isArray(table.modes) && table.modes.length > 0);
    setSelectedTableIds((prev) => {
      const isSelecting = !prev.includes(id);
      if (isSelecting && hasModes && table?.modes?.[0]) {
        setSelectedModes((m) => ({ ...m, [id]: table.modes![0].id }));
      }
      return isSelecting ? [...prev, id] : prev.filter((t) => t !== id);
    });
    setDurations((prev) => ({ ...prev, [id]: prev[id] ?? 60 }));
  }

  function createOrder() {
    if (!customerName.trim()) { setError("Customer name is required"); return; }
    if (selectedTableIds.length === 0) { setError("Select at least one table"); return; }

    const conflicts = selectedTableIds.filter((id) => bookingConflict(id) !== null);
    if (conflicts.length > 0) {
      const names = conflicts.map((id) => idleTables.find((t) => t.id === id)?.name ?? id).join(", ");
      setError(`Conflict on ${names} — reduce duration or pick another table.`);
      return;
    }

    // Phone-as-identity: if the stored profile name differs, ask before submit
    const typed   = customerName.trim();
    const stored  = customer?.name?.trim();
    if (customerPhone.trim().length === 10 && stored && stored.toLowerCase() !== typed.toLowerCase()) {
      setNameMismatch({ existing: stored, entered: typed });
      return;
    }
    void submitOrder(typed);
  }

  async function submitOrder(finalName: string) {
    setLoading(true); setError(null);

    const items = selectedTableIds.map((tid) => {
      const table = tables.find((t) => t.id === tid) as Table;
      const hasModes = Boolean(table?.modes && Array.isArray(table.modes) && table.modes.length > 0);
      const chosenModeId = selectedModes[tid];
      const chosenMode = hasModes ? (table.modes!.find(m => m.id === chosenModeId) || table.modes![0]) : null;
      const ratePerHour = chosenMode ? chosenMode.hourly_rate : table.hourly_rate;
      return {
        table_id: tid,
        duration_mins: durations[tid] ?? 60,
        rate_per_hour: ratePerHour,
        selected_mode_name: chosenMode ? chosenMode.name : undefined,
      };
    });

    const res = await fetch("/api/walkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location_id: locationId,
        customer_name: finalName,
        customer_phone: customerPhone.trim() || undefined,
        items,
      }),
    });

    const body = await res.json() as
      | { success: true;  data: { order_id: string } }
      | { success: false; error: string };

    if (!body.success) { setError(body.error); setLoading(false); return; }

    qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    qc.invalidateQueries({ queryKey: ["pos-tables", locationId] });
    close();
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      {nameMismatch && (
        <NameMismatchModal
          existingName={nameMismatch.existing}
          enteredName={nameMismatch.entered}
          phone={customerPhone}
          onCancel={() => setNameMismatch(null)}
          onUseExisting={() => {
            setCustomerName(nameMismatch.existing);
            const chosen = nameMismatch.existing;
            setNameMismatch(null);
            void submitOrder(chosen);
          }}
          onUpdateName={() => {
            const chosen = nameMismatch.entered;
            setNameMismatch(null);
            void submitOrder(chosen);
          }}
        />
      )}
      <div className="flex-1 bg-black/50 dark:bg-black/60" onClick={close} />
      <div className="w-96 flex flex-col bg-white dark:bg-[#111] border-l border-gray-200 dark:border-[#1F1F1F]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-[#1F1F1F]">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white text-base">New Walk-in</h2>
            <p className="text-xs mt-0.5 text-gray-400 dark:text-[#555]">Create and start a session</p>
          </div>
          <button
            onClick={close}
            className="text-gray-400 dark:text-[#555] hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

          {/* Customer section */}
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-[#444]">Customer</p>
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 dark:text-[#888]">Name *</label>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer name"
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors
                  bg-gray-100 dark:bg-[#1A1A1A]
                  border border-gray-200 dark:border-[#2A2A2A]
                  text-gray-900 dark:text-white
                  placeholder-gray-400 dark:placeholder-[#444]
                  focus:border-[#D4541A]"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 dark:text-[#888]">Phone</label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="Phone number"
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors
                  bg-gray-100 dark:bg-[#1A1A1A]
                  border border-gray-200 dark:border-[#2A2A2A]
                  text-gray-900 dark:text-white
                  placeholder-gray-400 dark:placeholder-[#444]
                  focus:border-[#D4541A]"
              />
              {lookingUp && <p className="text-xs text-gray-400 dark:text-[#555]">Looking up...</p>}
              {!lookingUp && customer && (
                <div className="space-y-1.5">
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.18)" }}
                  >
                    <Star className="h-3 w-3 shrink-0" style={{ color: "#f59e0b" }} />
                    <span className="text-xs font-medium" style={{ color: "#fbbf24" }}>
                      {customer.points_balance} pts · {customer.visit_count} visit{customer.visit_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {customer.active_memberships && customer.active_memberships.length > 0 && (
                    <div
                      className="flex flex-col gap-1 px-3 py-2 rounded-lg"
                      style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)" }}
                    >
                      <span className="text-xs font-bold" style={{ color: "#a78bfa" }}>
                        Member ID: {customer.active_memberships[0].short_id || "Active"}
                      </span>
                      <span className="text-[10px] text-purple-400 font-semibold">
                        Plans: {customer.active_memberships.map((m: any) => m.plan?.name).join(", ")}
                      </span>
                      <span className="text-[9px] text-gray-400 dark:text-[#555] italic">
                        * Validate ID at final payment to apply benefits
                      </span>
                    </div>
                  )}
                </div>
              )}
              {!lookingUp && customerPhone.trim().length >= 6 && !customer && (
                <p className="text-xs text-gray-400 dark:text-[#444]">New customer</p>
              )}
            </div>
          </div>

          {/* Tables section */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-[#444]">Tables</p>
            {idleTables.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-[#555]">No idle tables available</p>
            )}
            {idleTables.map((table) => {
              const selected = selectedTableIds.includes(table.id);
              const dur      = durations[table.id] ?? 60;
              const conflict = selected ? bookingConflict(table.id) : null;

              const tableCardClass = selected
                ? conflict
                  ? "bg-red-50 dark:bg-[rgba(239,68,68,0.06)] border border-red-400"
                  : "bg-orange-50 dark:bg-[rgba(212,84,26,0.06)] border border-[#D4541A]"
                : "bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#2A2A2A]";

              return (
                <div key={table.id} className="space-y-2">
                  <button
                    onClick={() => toggleTable(table.id)}
                    className={`w-full text-left rounded-xl px-3.5 py-3 transition-all ${tableCardClass}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-gray-900 dark:text-white">{table.name}</span>
                      <div className="text-right">
                        <span className="text-xs text-gray-500 dark:text-[#666]">{formatCurrency(table.hourly_rate)}/hr</span>
                        {selected && (() => {
                          const chosenModeId = selectedModes[table.id];
                          const chosenMode = table.modes?.find(m => m.id === chosenModeId) ?? table.modes?.[0] ?? null;
                          const rate = chosenMode ? chosenMode.hourly_rate : table.hourly_rate;
                          const dur = durations[table.id] ?? 60;
                          const gross = Math.round(rate * dur / 60 * 100) / 100;
                          return (
                            <p className="text-xs font-semibold tabular-nums" style={{ color: "#D4541A" }}>
                              {formatCurrency(gross)}
                            </p>
                          );
                        })()}
                      </div>
                    </div>
                    {!selected && table.upcomingBooking && (
                      <p className="text-xs mt-1" style={{ color: "#f59e0b" }}>
                        Booked {new Date(table.upcomingBooking.scheduled_start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        {table.upcomingBooking.order?.customer_name ? ` · ${table.upcomingBooking.order.customer_name}` : ""}
                      </p>
                    )}
                    {conflict && (
                      <p className="text-xs mt-1" style={{ color: "#f87171" }}>{conflict}</p>
                    )}
                  </button>

                  {selected && (
                    <div className="px-1 space-y-3">
                      {table.modes && Array.isArray(table.modes) && table.modes.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-xs text-gray-500 dark:text-[#666]">Pricing Mode</p>
                          <div className="flex flex-wrap gap-1.5">
                            {table.modes.map((m) => {
                              const active = (selectedModes[table.id] ?? table.modes![0].id) === m.id;
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => setSelectedModes((prev) => ({ ...prev, [table.id]: m.id }))}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                                    active
                                      ? "bg-purple-600 text-white shadow-sm"
                                      : "bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] text-gray-700 dark:text-[#888]"
                                  }`}
                                >
                                  {m.name} ({formatCurrency(m.hourly_rate)}/hr)
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <p className="text-xs text-gray-500 dark:text-[#666]">Duration</p>
                        <div className="flex gap-1.5">
                          {(() => {
                            const chosenModeId = selectedModes[table.id];
                            const chosenMode = table.modes?.find(m => m.id === chosenModeId);
                            const isSim = isSimulatorActive(table, chosenMode);
                            const presets = isSim ? [{ label: "15m", mins: 15 }, ...DURATION_PRESETS] : DURATION_PRESETS;
                            return presets.map((p) => (
                              <button
                                key={p.mins}
                                onClick={() => setDurations((prev) => ({ ...prev, [table.id]: p.mins }))}
                                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                  dur === p.mins
                                    ? "text-white"
                                    : "bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] text-gray-600 dark:text-[#666]"
                                }`}
                                style={dur === p.mins ? { background: "#D4541A" } : {}}
                              >
                                {p.label}
                              </button>
                            ));
                          })()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="15"
                          max="480"
                          step="15"
                          value={dur}
                          onChange={(e) => setDurations((prev) => ({ ...prev, [table.id]: parseInt(e.target.value) || 60 }))}
                          className="w-20 text-sm rounded-lg px-2.5 py-1.5 outline-none transition-colors
                            bg-gray-100 dark:bg-[#1A1A1A]
                            border border-gray-200 dark:border-[#2A2A2A]
                            text-gray-900 dark:text-white
                            focus:border-[#D4541A]"
                        />
                        <span className="text-xs text-gray-400 dark:text-[#555]">mins</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && (
            <p
              className="text-sm rounded-lg px-3 py-2"
              style={{ background: "rgba(239,68,68,0.07)", color: "#f87171", border: "1px solid rgba(239,68,68,0.18)" }}
            >
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 dark:border-[#1F1F1F] space-y-2">
          {outsideHours && (
            <div
              className="px-3 py-2 rounded-lg text-xs font-semibold text-center"
              style={{
                background: "rgba(239,68,68,0.1)",
                border:     "1px solid rgba(239,68,68,0.25)",
                color:      "#ef4444",
              }}
            >
              {beforeOpen
                ? `Shop opens at ${openingTime} — walk-ins disabled`
                : `Shop closed for the day — walk-ins disabled`}
            </div>
          )}
          <button
            onClick={createOrder}
            disabled={loading || outsideHours}
            className="w-full py-3 rounded-xl font-bold text-white text-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: outsideHours ? "#9ca3af" : "#D4541A" }}
          >
            {loading ? "Starting..." : "Start Walk-in"}
          </button>
        </div>
      </div>
    </div>
  );
}
