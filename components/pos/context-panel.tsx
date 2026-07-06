"use client";

import { useState, useRef, memo, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { useNowSampled } from "@/hooks/use-now-sampled";
import { NameMismatchModal } from "./name-mismatch-modal";
import type { InventoryItem } from "@/lib/supabase/types";
import { calculateBill, computeFreeHoursDiscount } from "@/lib/billing/engine";

import { formatCurrency, formatSignedCountdown, getShopWindow, isSimulatorTable } from "@/lib/utils";
import type { AppSettings } from "@/lib/settings";

import { X, Plus, Trash2, Square, Timer, Star } from "lucide-react";
import { toast } from "sonner";
import type { OrderItem, OrderExtra } from "@/lib/supabase/types";
import type { POSOrder, TableWithStatus } from "@/store/pos";

// ─── Shared types ────────────────────────────────────────────────────────────

interface CustomerLookup {
  name: string | null;
  points_balance: number;
  visit_count: number;
}

const DURATION_PRESETS = [
  { label: "30m",  mins: 30  },
  { label: "1h",   mins: 60  },
  { label: "1.5h", mins: 90  },
  { label: "2h",   mins: 120 },
];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function PanelHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose?: () => void;
}) {
  return (
    <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-[#222]">
      <div className="min-w-0">
        <p className="font-bold text-gray-900 dark:text-white text-base truncate">{title}</p>
        {subtitle && (
          <p className="text-xs mt-0.5 text-gray-600 dark:text-[#aaa] truncate">{subtitle}</p>
        )}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="shrink-0 ml-3 p-1.5 rounded-lg text-gray-500 dark:text-[#888] hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ─── Walk-in: idle table ─────────────────────────────────────────────────────

function PanelWalkIn({
  locationId,
  table,
}: {
  locationId: string;
  table: TableWithStatus;
}) {
  const setSelectedTableId = usePOSStore((s) => s.setSelectedTableId);
  // PanelWalkIn only uses `now` for hour-granularity checks (shop hours +
  // minutes-until-next-booking) — per-second precision would cost a full
  // re-render of this form (autocomplete debouncers, 10+ state hooks) every
  // tick for nothing visible. 30s sampling is plenty.
  const now         = useNowSampled(30_000);
  const openingTime = usePOSStore((s) => s.openingTime);
  const closingTime = usePOSStore((s) => s.closingTime);
  const qc    = useQueryClient();

  const [customerName,  setCustomerName]  = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [duration,      setDuration]      = useState(60);
  const [durationInput, setDurationInput] = useState("60"); // raw string so it can be erased
  // People / controller count — keys into table.people_pricing. When set,
  // overrides table.hourly_rate with the tier rate.
  const tableModes = useMemo(() => {
    if (table.modes && Array.isArray(table.modes) && table.modes.length > 0) {
      return table.modes as { id: string; name: string; hourly_rate: number; pricing_basis?: string; people_pricing?: Record<string, number> | null }[];
    }
    return [];
  }, [table]);

  const [selectedModeId, setSelectedModeId] = useState<string | null>(
    tableModes.length > 0 ? tableModes[0].id : null
  );
  const selectedMode = useMemo(() =>
    tableModes.find(m => m.id === selectedModeId) ?? tableModes[0] ?? null,
    [tableModes, selectedModeId]
  );

  // People options: from selected mode if modes exist, else from table
  const peopleOptions = useMemo(() => {
    if (selectedMode) {
      if (selectedMode.people_pricing && typeof selectedMode.people_pricing === "object") {
        const keys = Object.keys(selectedMode.people_pricing)
          .filter(k => Boolean(selectedMode.people_pricing![k]))
          .sort((a, b) => Number(a) - Number(b));
        if (keys.length > 0) return keys;
      }
      if (selectedMode.pricing_basis === "controller") return ["1", "2"];
      if (selectedMode.pricing_basis === "player") return ["1", "2", "3", "4"];
      return [];
    }
    if (isSimulatorTable(table)) {
      if (table.people_pricing && typeof table.people_pricing === "object") {
        const dbKeys = Object.keys(table.people_pricing)
          .filter((k) => Boolean(table.people_pricing![k]))
          .sort((a, b) => Number(a) - Number(b));
        if (dbKeys.length > 0) return dbKeys;
      }
      return ["1", "2"];
    }
    if (!table.people_pricing) return [];
    return Object.keys(table.people_pricing).sort((a, b) => Number(a) - Number(b));
  }, [table, selectedMode]);
  const peopleLabel   = table.type === "ps5" ? "controller" : "player";
  const [numPeople,   setNumPeople]   = useState<string | null>(null);
  const effectiveRate = (() => {
    // Mode-aware rate: mode's people_pricing > mode's hourly_rate > table people_pricing > table hourly_rate
    if (selectedMode) {
      if (numPeople && selectedMode.people_pricing?.[numPeople]) {
        return selectedMode.people_pricing[numPeople];
      }
      return selectedMode.hourly_rate;
    }
    if (numPeople && table.people_pricing?.[numPeople]) {
      return table.people_pricing[numPeople];
    }
    if (isSimulatorTable(table)) {
      const factor = numPeople ? Math.max(1, Number(numPeople)) : 1;
      return table.hourly_rate * factor;
    }
    return table.hourly_rate;
  })();

  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [customer,      setCustomer]      = useState<CustomerLookup | null>(null);
  const [lookingUp,     setLookingUp]     = useState(false);
  // When the typed name disagrees with the name stored against this phone,
  // we open this modal at submit-time and let staff pick. Phone is the
  // identity; whichever name they pick is what we ultimately send.
  const [nameMismatch, setNameMismatch] = useState<{ existing: string; entered: string } | null>(null);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Autocomplete state — name and phone each have their own dropdown.
  // Both fetch from /api/customers/search which routes digit-only queries
  // to phone prefix and everything else to name prefix.
  type CustomerSuggestion = { phone: string; name: string | null; visit_count: number; points_balance: number };
  const [nameSuggestions,      setNameSuggestions]      = useState<CustomerSuggestion[]>([]);
  const [phoneSuggestions,     setPhoneSuggestions]     = useState<CustomerSuggestion[]>([]);
  const [showNameSuggestions,  setShowNameSuggestions]  = useState(false);
  const [showPhoneSuggestions, setShowPhoneSuggestions] = useState(false);
  const nameSearchTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameSearchAbort   = useRef<AbortController | null>(null);
  const phoneSearchTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phoneSearchAbort  = useRef<AbortController | null>(null);

  // Operating hours — shared helper handles midnight-crossing locations
  const { beforeOpen, outsideHours, minsUntilClose } = getShopWindow(now, openingTime, closingTime);

  // Effective ceiling: min of (next booking gap − 5 min buffer) AND (shop close)
  const bookingCeiling = table.upcomingBooking
    ? Math.max(0, Math.floor((new Date(table.upcomingBooking.scheduled_start).getTime() - now.getTime()) / 60000) - 5)
    : 240;
  const maxMins = Math.max(15, Math.min(bookingCeiling, minsUntilClose || 0));

  const availablePresets = DURATION_PRESETS.filter((p) => p.mins <= maxMins);

  function handlePhoneChange(val: string) {
    // Digits only, max 10
    const cleaned = val.replace(/\D/g, "").slice(0, 10);
    setCustomerPhone(cleaned);
    setCustomer(null);

    // Cancel in-flight phone search + debounce timer
    if (phoneSearchTimer.current) clearTimeout(phoneSearchTimer.current);
    if (phoneSearchAbort.current) phoneSearchAbort.current.abort();

    // Exact-match path: 10 digits = canonical lookup that drives the points badge
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (cleaned.length === 10) {
      // Full number entered — hide the prefix dropdown, run the exact lookup
      setPhoneSuggestions([]);
      setShowPhoneSuggestions(false);
      setLookingUp(true);
      lookupTimer.current = setTimeout(async () => {
        const res  = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(cleaned)}`);
        const data = await res.json() as { found: boolean; customer: CustomerLookup | null };
        setCustomer(data.customer);
        // Auto-fill name ONLY when the field is blank. If staff has already
        // typed a name, leave it — the mismatch popup at submit-time will let
        // them choose between the typed name and the stored one.
        if (data.found && data.customer?.name && !customerName.trim()) {
          setCustomerName(data.customer.name);
        }
        setLookingUp(false);
      }, 600);
      return;
    }

    setLookingUp(false);

    // Prefix-match path: 3–9 digits, fire the same search endpoint we use for name
    if (cleaned.length < 3) {
      setPhoneSuggestions([]);
      setShowPhoneSuggestions(false);
      return;
    }
    phoneSearchTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      phoneSearchAbort.current = controller;
      try {
        const res  = await fetch(`/api/customers/search?q=${encodeURIComponent(cleaned)}`, { signal: controller.signal });
        const body = await res.json() as
          | { success: true;  data: CustomerSuggestion[] }
          | { success: false; error: string };
        if (body.success) {
          setPhoneSuggestions(body.data);
          setShowPhoneSuggestions(body.data.length > 0);
        }
      } catch {
        // Aborted or network — silent. Staff can still type the full number.
      }
    }, 300);
  }

  function handleNameChange(val: string) {
    // Letters and spaces only
    const cleaned = val.replace(/[^a-zA-Z\s]/g, "");
    setCustomerName(cleaned);

    // Cancel any in-flight name-search request + pending debounce
    if (nameSearchTimer.current) clearTimeout(nameSearchTimer.current);
    if (nameSearchAbort.current) nameSearchAbort.current.abort();

    const q = cleaned.trim();
    if (q.length < 2) {
      setNameSuggestions([]);
      setShowNameSuggestions(false);
      return;
    }

    // 300ms debounce — matches existing handlePhoneChange pattern
    nameSearchTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      nameSearchAbort.current = controller;
      try {
        const res  = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const body = await res.json() as
          | { success: true; data: { phone: string; name: string | null; visit_count: number; points_balance: number }[] }
          | { success: false; error: string };
        if (body.success) {
          setNameSuggestions(body.data);
          setShowNameSuggestions(body.data.length > 0);
        }
      } catch {
        // Aborted or network — silent. User can still type the name manually.
      }
    }, 300);
  }

  function pickSuggestion(s: CustomerSuggestion) {
    setCustomerName(s.name ?? "");
    setCustomerPhone(s.phone);
    // Mirror the existing phone-lookup behaviour so the "X pts" badge shows
    setCustomer({ name: s.name, points_balance: s.points_balance, visit_count: s.visit_count });
    // Dismiss both dropdowns and cancel any pending searches in either field
    setShowNameSuggestions(false);
    setShowPhoneSuggestions(false);
    setNameSuggestions([]);
    setPhoneSuggestions([]);
    if (nameSearchTimer.current)  clearTimeout(nameSearchTimer.current);
    if (phoneSearchTimer.current) clearTimeout(phoneSearchTimer.current);
    if (nameSearchAbort.current)  nameSearchAbort.current.abort();
    if (phoneSearchAbort.current) phoneSearchAbort.current.abort();
  }

  function startWalkIn() {
    if (outsideHours) {
      setError(beforeOpen ? "Shop hasn't opened yet" : "Shop has closed for the day");
      return;
    }
    if (!customerName.trim() || customerName.trim().length < 2) { setError("Customer name is required"); return; }
    if (customerPhone && customerPhone.length !== 10) { setError("Phone must be exactly 10 digits"); return; }
    if (duration > minsUntilClose) {
      setError(`Only ${minsUntilClose} min until shop closes`);
      return;
    }

    // Phone-as-identity check: if the stored profile name differs from
    // what staff typed, open the mismatch popup instead of submitting.
    // Modal buttons (Use existing / Update name) call submitWalkIn() with
    // the chosen name directly.
    const typed   = customerName.trim();
    const stored  = customer?.name?.trim();
    if (customerPhone.length === 10 && stored && stored.toLowerCase() !== typed.toLowerCase()) {
      setNameMismatch({ existing: stored, entered: typed });
      return;
    }

    void submitWalkIn(typed);
  }

  async function submitWalkIn(finalName: string) {
    setLoading(true);
    setError(null);

    // Combined endpoint: creates order + starts session in one round trip
    const res = await fetch("/api/walkin", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        location_id:    locationId,
        customer_name:  finalName,
        customer_phone: customerPhone.trim() || undefined,
        items: [{
          table_id:           table.id,
          duration_mins:      duration,
          rate_per_hour:      effectiveRate,
          num_people:         numPeople ? Number(numPeople) : undefined,
          selected_mode_name: selectedMode ? selectedMode.name : undefined,
        }],
      }),
    });

    const body = await res.json() as
      | { success: true;  data: { order_id: string } }
      | { success: false; error: string };

    if (!body.success) {
      setError(body.error);
      setLoading(false);
      return;
    }

    // ── Optimistic push so the right panel flips to PanelSession instantly ──
    // Previously the staff waited 200-500ms for the network refetch to land
    // AND for the cascading buildTableStatus + ContextPanel re-render. Cold
    // start on Vercel's edge could stretch that to several seconds. Now we
    // push the new order into the store immediately using the data we just
    // sent — Realtime + the background invalidate below reconcile any
    // server-side differences (the real ids, etc.) once they arrive.
    const nowIso = new Date().toISOString();
    const expectedEnd = new Date(Date.now() + duration * 60 * 1000).toISOString();
    const tempItemId = `temp-item-${Math.random().toString(36).slice(2)}`;
    const optimisticOrder: POSOrder = {
      id:               body.data.order_id,
      location_id:      locationId,
      type:             "walk_in",
      status:           "open",
      customer_name:    finalName,
      customer_phone:   customerPhone.trim() || null,
      created_by:       null,
      created_at:       nowIso,
      finalized_at:     null,
      coupon_id:        null,
      membership_id:    null,
      advance_paid:     0,
      points_redeemed:        0,
      subtotal:               0,
      discount_amount:        0,
      public_discount_amount: 0,
      total_amount:           0,
      amount_due:             0,
      extras: [],
      items: [{
        id:                      tempItemId,
        order_id:                body.data.order_id,
        table_id:                table.id,
        status:                  "running",
        scheduled_start:         null,
        scheduled_end:           null,
        scheduled_duration_mins: duration,
        actual_start:            nowIso,
        actual_end:              null,
        expected_end:            expectedEnd,
        extended_mins:           0,
        rate_per_hour:           effectiveRate,
        final_amount:            null,
        num_people:              numPeople ? Number(numPeople) : null,
        is_deleted:              false,
        deleted_at:              null,
        created_at:              nowIso,
        table:                   table,
      }],
    };
    usePOSStore.setState((s) => ({ openOrders: [...s.openOrders, optimisticOrder] }));
    // selectedTableId already points at this table; ContextPanel will see the
    // running item in openOrders + flip to PanelSession on the very next render.

    // Reconcile in the background — Realtime usually catches this in <1s but
    // the explicit invalidate guarantees the table grid + bill numbers swap
    // from optimistic to authoritative server state regardless.
    qc.invalidateQueries({ queryKey: ["pos-orders",  locationId] });
    qc.invalidateQueries({ queryKey: ["pos-tables",  locationId] });
    setLoading(false);
  }

  return (
    <div className="flex flex-col h-full">
      {nameMismatch && (
        <NameMismatchModal
          existingName={nameMismatch.existing}
          enteredName={nameMismatch.entered}
          phone={customerPhone}
          onCancel={() => setNameMismatch(null)}
          onUseExisting={() => {
            // Replace the typed name with the existing one and submit.
            // The upsert in /api/walkin will write the same name back —
            // effectively a no-op on the profile.
            setCustomerName(nameMismatch.existing);
            const chosen = nameMismatch.existing;
            setNameMismatch(null);
            void submitWalkIn(chosen);
          }}
          onUpdateName={() => {
            // Keep the typed name and submit. The upsert overwrites
            // customer_profiles.name so the owner panel will reflect
            // the new name on the next refresh.
            const chosen = nameMismatch.entered;
            setNameMismatch(null);
            void submitWalkIn(chosen);
          }}
        />
      )}
      <PanelHeader
        title={`Walk-in — ${table.name}`}
        subtitle={
          table.upcomingBooking
            ? `Available until ${fmtTime(table.upcomingBooking.scheduled_start)} · max ${maxMins}m`
            : "No upcoming bookings"
        }
        onClose={() => setSelectedTableId(null)}
      />

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

        {/* Customer */}
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-600 dark:text-[#bbb]">
            Customer
          </p>
          <div className="relative">
            <input
              value={customerName}
              onChange={(e) => handleNameChange(e.target.value)}
              onFocus={() => { if (nameSuggestions.length > 0) setShowNameSuggestions(true); }}
              onBlur={() => {
                // Delay so a click on a suggestion (which is a mousedown) registers
                // before the dropdown disappears.
                setTimeout(() => setShowNameSuggestions(false), 150);
              }}
              placeholder="Customer name *"
              autoFocus
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none transition-colors
                bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
                text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#666]
                focus:border-[#D4541A]"
            />
            {showNameSuggestions && nameSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-lg overflow-hidden shadow-lg
                bg-white dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333]"
              >
                {nameSuggestions.map((s) => (
                  <button
                    key={s.phone}
                    onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors
                      hover:bg-gray-100 dark:hover:bg-[#222] border-b last:border-b-0 border-gray-100 dark:border-[#262626]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                        {s.name ?? "(no name)"}
                      </p>
                      <p className="text-xs font-mono text-gray-600 dark:text-[#aaa]">{s.phone}</p>
                    </div>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}
                    >
                      {s.visit_count}× · {s.points_balance} pts
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={10}
              value={customerPhone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              onFocus={() => { if (phoneSuggestions.length > 0) setShowPhoneSuggestions(true); }}
              onBlur={() => {
                // Delay so a click on a suggestion (mousedown) registers before close
                setTimeout(() => setShowPhoneSuggestions(false), 150);
              }}
              placeholder="10-digit phone (optional)"
              autoComplete="off"
              className="w-full px-3 py-2.5 rounded-lg text-sm font-medium outline-none transition-colors
                bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
                text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#666]
                focus:border-[#D4541A]"
            />
            {showPhoneSuggestions && phoneSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-lg overflow-hidden shadow-lg
                bg-white dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333]"
              >
                {phoneSuggestions.map((s) => (
                  <button
                    key={s.phone}
                    onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors
                      hover:bg-gray-100 dark:hover:bg-[#222] border-b last:border-b-0 border-gray-100 dark:border-[#262626]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                        {s.phone}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-[#aaa] truncate">
                        {s.name ?? "(no name)"}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}
                    >
                      {s.visit_count}× · {s.points_balance} pts
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {lookingUp && (
            <p className="text-xs text-gray-500 dark:text-[#999]">Looking up…</p>
          )}
          {!lookingUp && customer && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)" }}
            >
              <Star className="h-3.5 w-3.5 shrink-0" style={{ color: "#f59e0b" }} />
              <span className="text-sm font-semibold" style={{ color: "#fbbf24" }}>
                {customer.points_balance} pts · {customer.visit_count} visit{customer.visit_count !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          {!lookingUp && customerPhone.length === 10 && !customer && (
            <p className="text-xs font-medium text-gray-500 dark:text-[#888]">New customer</p>
          )}
        </div>

        {/* Mode selector — only shown when table has dynamic pricing modes */}
        {tableModes.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-600 dark:text-[#bbb]">
                Pricing Mode
              </p>
              <p className="text-[11px] font-semibold text-gray-500 dark:text-[#888]">
                ₹{effectiveRate}/hr
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {tableModes.map((m) => {
                const active = (selectedModeId ?? tableModes[0]?.id) === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => { setSelectedModeId(m.id); setNumPeople(null); }}
                    className={`px-3 py-2 rounded-lg text-sm font-bold transition-all ${
                      active
                        ? "text-white"
                        : "bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] text-gray-700 dark:text-[#ccc]"
                    }`}
                    style={active ? { background: "#7c3aed" } : {}}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* People / controller count — only shown when the table/mode has tiered pricing */}
        {peopleOptions.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-600 dark:text-[#bbb]">
                {peopleLabel}s
              </p>
              <p className="text-[11px] font-semibold text-gray-500 dark:text-[#888]">
                ₹{effectiveRate}/hr
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {peopleOptions.map((n: string) => {
                const selected = numPeople === n;
                return (
                  <button
                    key={n}
                    onClick={() => setNumPeople(selected ? null : n)}
                    className={`px-3 py-2 rounded-lg text-sm font-bold transition-all min-w-[60px] ${
                      selected
                        ? "text-white"
                        : "bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] text-gray-700 dark:text-[#ccc]"
                    }`}
                    style={selected ? { background: "#D4541A" } : {}}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-gray-500 dark:text-[#888]">
              {numPeople
                ? `${numPeople} ${peopleLabel}${Number(numPeople) > 1 ? "s" : ""} · tier rate applied`
                : `Defaulting to flat ₹${table.hourly_rate}/hr — pick a count to apply tier pricing`}
            </p>
          </div>
        )}

        {/* Duration */}
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-600 dark:text-[#bbb]">
            Duration
          </p>
          <div className="flex gap-2">
            {availablePresets.map((p) => (
              <button
                key={p.mins}
                onClick={() => { setDuration(p.mins); setDurationInput(String(p.mins)); }}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                  duration === p.mins
                    ? "text-white"
                    : "bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] text-gray-700 dark:text-[#ccc]"
                }`}
                style={duration === p.mins ? { background: "#D4541A" } : {}}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="15"
              max={maxMins}
              step="15"
              value={durationInput}
              onChange={(e) => {
                // Allow the field to be fully erased; only update `duration` when there's a value
                const raw = e.target.value;
                setDurationInput(raw);
                if (raw === "") return;
                const n = parseInt(raw);
                if (Number.isFinite(n) && n > 0) setDuration(Math.min(maxMins, n));
              }}
              onBlur={() => {
                // Snap back to a valid number on blur if user left it blank or below min
                const n = parseInt(durationInput);
                if (!Number.isFinite(n) || n < 15) {
                  setDuration(60);
                  setDurationInput("60");
                } else {
                  const clamped = Math.min(maxMins, n);
                  setDuration(clamped);
                  setDurationInput(String(clamped));
                }
              }}
              className="w-20 text-sm font-semibold rounded-lg px-2.5 py-1.5 outline-none transition-colors
                bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
                text-gray-900 dark:text-white focus:border-[#D4541A]"
            />
            <span className="text-xs font-semibold text-gray-500 dark:text-[#999]">mins</span>
            {table.upcomingBooking && (
              <span className="text-xs text-gray-500 dark:text-[#999]">(max {maxMins}m)</span>
            )}
          </div>
        </div>

        {error && (
          <p
            className="text-sm rounded-lg px-3 py-2"
            style={{
              background: "rgba(239,68,68,0.07)",
              color: "#f87171",
              border: "1px solid rgba(239,68,68,0.18)",
            }}
          >
            {error}
          </p>
        )}
      </div>

      <div className="shrink-0 px-5 py-4 border-t border-gray-200 dark:border-[#222] space-y-2">
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
          onClick={startWalkIn}
          disabled={loading || outsideHours}
          className="w-full py-3.5 rounded-xl font-bold text-white text-base transition-opacity hover:opacity-90 disabled:opacity-40 shadow-lg"
          style={{
            background: outsideHours ? "#9ca3af" : "#D4541A",
            boxShadow: outsideHours ? "none" : "0 6px 20px rgba(212,84,26,0.35)",
          }}
        >
          {loading ? "Starting…" : "Start Walk-in"}
        </button>
      </div>
    </div>
  );
}

// ─── Inline player / controller picker for a running session ────────────────
// Optimistic: store updates the moment a chip is tapped (so the bill in the
// header recomputes instantly), reverts if the API call fails.
function PeoplePicker({
  item, locationId,
}: {
  item: POSOrder["items"][number];
  locationId: string;
}) {
  const patchOrderItem = usePOSStore((s) => s.patchOrderItem);
  const qc = useQueryClient();
  const [saving, setSaving] = useState<number | null>(null);

  const isSimulator = item.table ? isSimulatorTable(item.table) : false;
  const pricing = useMemo(() => (item.table?.people_pricing ?? {}) as Record<string, number>, [item.table?.people_pricing]);
  const options  = useMemo(() => {
    const dbKeys = Object.keys(pricing).filter(k => Boolean(pricing[k])).sort((a, b) => Number(a) - Number(b));
    if (dbKeys.length === 0 && isSimulator) {
      return ["1", "2"];
    }
    return dbKeys;
  }, [pricing, isSimulator]);

  if (options.length === 0) return null;
  const label    = isSimulator ? "player" : item.table?.type === "ps5" ? "controller" : "player";
  const current  = item.num_people ?? null;
  const baseRate = item.table?.hourly_rate ?? item.rate_per_hour;

  async function pick(n: number) {
    if (saving) return;
    const prev = { num_people: item.num_people, rate_per_hour: item.rate_per_hour };
    let newRate = pricing[String(n)] ?? baseRate;
    if (isSimulator && !pricing[String(n)] && n === 2) {
      newRate = baseRate * 2;
    }
    setSaving(n);
    patchOrderItem(item.id, { num_people: n, rate_per_hour: newRate });
    const res = await fetch("/api/sessions/people", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ order_item_id: item.id, num_people: n }),
    });
    if (!res.ok) {
      patchOrderItem(item.id, prev);
      const body = await res.json().catch(() => ({})) as { error?: string };
      toast.error(body.error ?? `Failed to update ${label}s`);
    } else {
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    }
    setSaving(null);
  }

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#0a0a0a] border border-gray-200 dark:border-[#222]">
      <span className="text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:text-[#999] shrink-0">
        {label}s
      </span>
      <div className="flex gap-1 flex-wrap justify-end">
        {options.map((n: string, idx: number) => {
          const num = Number(n);
          let selected = current === num;
          let labelText = n;

          if (idx === 0 && num > 1) {
            labelText = `1-${n}`;
            selected = current !== null && current <= num;
          }

          return (
            <button
              key={n}
              onClick={() => pick(num)}
              disabled={saving !== null}
              className={`min-w-[34px] px-2 py-1 rounded-md text-xs font-bold transition-all disabled:opacity-50 ${
                selected
                  ? "text-white"
                  : "bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] text-gray-700 dark:text-[#ccc]"
              }`}
              style={selected ? { background: "#D4541A" } : {}}
              title={`₹${pricing[n] ?? (isSimulator && n === "2" ? baseRate * 2 : baseRate)}/hr`}
            >
              {saving === num ? "…" : labelText}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Session: running or bill-ready order ─────────────────────────────────────

function PanelSession({
  locationId,
  order,
  closingTime,
}: {
  locationId: string;
  order: POSOrder;
  closingTime: string;
}) {
  const now               = usePOSStore((s) => s.now);
  const posTables         = usePOSStore((s) => s.tables);
  const pointsToRedeem    = usePOSStore((s) => s.pointsToRedeem);
  const selectedTableId   = usePOSStore((s) => s.selectedTableId);
  const patchOrderItem    = usePOSStore((s) => s.patchOrderItem);
  const addOrderExtra     = usePOSStore((s) => s.addOrderExtra);
  const removeOrderExtra  = usePOSStore((s) => s.removeOrderExtra);
  const patchOrderExtra   = usePOSStore((s) => s.patchOrderExtra);
  const replaceOrderExtraId = usePOSStore((s) => s.replaceOrderExtraId);
  const setExtendModal    = usePOSStore((s) => s.setExtendModalItem);
  const setStopConfirmItem = usePOSStore((s) => s.setStopConfirmItem);
  const setPointsToRedeem = usePOSStore((s) => s.setPointsToRedeem);
  const setFinalizeId     = usePOSStore((s) => s.setFinalizeOrderId);
  const setSelectedTableId = usePOSStore((s) => s.setSelectedTableId);
  const qc                = useQueryClient();

  const [catalogueOpen,   setCatalogueOpen]   = useState(false);
  const [redeemInput,    setRedeemInput]    = useState(String(pointsToRedeem[order.id] ?? 0));

  // Lazy — only fetch when staff opens the catalogue. Cached 5 min after first open.
  const { data: inventoryItems } = useQuery<InventoryItem[]>({
    queryKey: ["inventory", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/inventory?location_id=${locationId}`);
      const body = await res.json() as { success: true; data: InventoryItem[] } | { success: false; error: string };
      if (!body.success) return [];
      return body.data.filter((i) => i.is_active);
    },
    enabled: catalogueOpen,
    staleTime: 5 * 60 * 1000,
  });

  // Cached across order opens — same phone won't re-fetch within 60s
  const { data: customerInfo } = useQuery<{ points_balance: number; membership_discount_pct?: number; active_memberships?: any[] } | null>({
    queryKey: ["customer-lookup", order.customer_phone],
    queryFn: async () => {
      if (!order.customer_phone) return null;
      const res  = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(order.customer_phone)}`);
      const body = await res.json() as { found: boolean; customer: { points_balance: number; membership_discount_pct?: number; active_memberships?: any[] } | null };
      return body.customer;
    },
    enabled: !!order.customer_phone,
    staleTime: 60 * 1000,
  });

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      const body = await res.json() as { success: boolean; data?: AppSettings };
      if (!body.success || !body.data) throw new Error("Failed to load settings");
      return body.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const activeItems  = order.items.filter((i) => i.status !== "cancelled" && i.status !== "scheduled" && !i.is_deleted);
  const activeExtras = order.extras.filter((e) => !e.is_deleted);
  const groupedExtras = Array.from(
    activeExtras.reduce((acc, current) => {
      const key = `${current.name}_${current.price}_${current.inventory_item_id || ""}`;
      const existing = acc.get(key);
      if (existing) {
        existing.quantity += current.quantity;
        existing.ids.push(current.id);
      } else {
        acc.set(key, { ...current, ids: [current.id] } as any);
      }
      return acc;
    }, new Map<string, OrderExtra & { ids: string[] }>())
    .values()
  );
  const posTablesStore = usePOSStore((s) => s.tables);
  const publicDiscount = (order as any)?.public_discount_amount ?? order.discount_amount ?? 0;
  const isMembershipApplied = !!order.membership_id;
  const applicableMemberships = isMembershipApplied && customerInfo?.active_memberships
    ? customerInfo.active_memberships.filter((m: any) => m.id === order.membership_id)
    : [];
  const freeHrsDiscount = computeFreeHoursDiscount(activeItems, applicableMemberships, now, posTablesStore);
  const applicableMembershipPct = applicableMemberships.reduce((max: number, m: any) => {
    const pct = m.plan?.discount_pct ?? 0;
    return pct > max ? pct : max;
  }, 0);
  const bill         = calculateBill(activeItems, activeExtras, now, null, order.advance_paid ?? 0, publicDiscount, applicableMembershipPct, freeHrsDiscount);
  const hasRunning   = activeItems.some((i) => i.status === "running");

  const redeemRate        = settings?.loyalty?.redeem_rupees_per_point ?? 1;
  const minPointsToRedeem = settings?.loyalty?.min_points_to_redeem ?? 100;

  const redeemPoints  = Math.max(0, parseInt(redeemInput) || 0);
  const maxPointsByBill = Math.floor(bill.totalDue / redeemRate);
  const maxRedeem     = Math.min(customerInfo?.points_balance ?? 0, maxPointsByBill);
  // Minimum configurable points balance required to qualify for redemption
  const clampedRedeem = ((customerInfo?.points_balance ?? 0) >= minPointsToRedeem) ? Math.min(redeemPoints, maxRedeem) : 0;
  const displayTotal  = Math.max(0, Math.round((bill.totalDue - (clampedRedeem * redeemRate)) * 100) / 100);

  function handleRedeemChange(val: string) {
    setRedeemInput(val);
    const n = Math.max(0, parseInt(val) || 0);
    setPointsToRedeem(order.id, Math.min(n, maxRedeem));
  }

  // Tracks optimistic extras whose POST is still in flight: tempId → promise
  // that resolves with the real DB id (or rejects if the add failed).
  // PATCH/DELETE handlers await this so they can't 404 on a tempId.
  const pendingExtras = useRef<Map<string, Promise<string>>>(new Map());
  async function resolveRealExtraId(id: string): Promise<string> {
    const pending = pendingExtras.current.get(id);
    return pending ? await pending : id;
  }

  async function addExtraItem(opts: {
    name: string;
    price: number;
    cost_price?: number;
    quantity: number;
    inventory_item_id?: string;
  }): Promise<string> {
    const tempId     = crypto.randomUUID();
    const optimistic: OrderExtra = {
      id:                tempId,
      order_id:          order.id,
      name:              opts.name,
      price:             opts.price,
      cost_price:        opts.cost_price ?? 0,
      quantity:          opts.quantity,
      inventory_item_id: opts.inventory_item_id ?? null,
      is_deleted:        false,
      deleted_at:        null,
      added_by:          null,
      created_at:        new Date().toISOString(),
    };
    addOrderExtra(order.id, optimistic);

    const addPromise: Promise<string> = (async () => {
      const res = await fetch(`/api/orders/${order.id}/extras`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:              opts.name,
          price:             opts.price,
          cost_price:        opts.cost_price ?? 0,
          quantity:          opts.quantity,
          inventory_item_id: opts.inventory_item_id,
        }),
      });
      if (!res.ok) {
        removeOrderExtra(order.id, tempId);
        toast.error("Failed to add extra");
        throw new Error("add extra failed");
      }
      const body = await res.json() as
        | { success: true;  data: { id: string } }
        | { success: false; error: string };
      if (!body.success) {
        removeOrderExtra(order.id, tempId);
        toast.error(body.error || "Failed to add extra");
        throw new Error(body.error);
      }
      // Swap the tempId for the real DB id so subsequent PATCH/DELETE works
      replaceOrderExtraId(order.id, tempId, body.data.id);
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      qc.invalidateQueries({ queryKey: ["inventory", locationId] });
      qc.invalidateQueries({ queryKey: ["inventory-low-list"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-count"] });
      return body.data.id;
    })();

    // Register the in-flight add so concurrent +/- clicks await it. Clean up
    // either way so the map doesn't grow forever.
    pendingExtras.current.set(tempId, addPromise);
    addPromise.finally(() => { pendingExtras.current.delete(tempId); });
    return addPromise;
  }

  async function deleteExtra(extraId: string) {
    // Optimistic remove uses whichever id the UI knows about; the DELETE then
    // waits for the add POST to resolve (if it was still in flight) so we
    // never hit the DB with a tempId that doesn't exist yet.
    removeOrderExtra(order.id, extraId);
    const realId = await resolveRealExtraId(extraId).catch(() => null);
    if (!realId) return; // add itself failed → nothing to delete server-side
    const res = await fetch(`/api/orders/${order.id}/extras/${realId}`, { method: "DELETE" });
    if (!res.ok) {
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    } else {
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      qc.invalidateQueries({ queryKey: ["inventory", locationId] });
      qc.invalidateQueries({ queryKey: ["inventory-low-list"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-count"] });
    }
  }

  // ─── Inventory quantity stepper helpers ───────────────────────────────────
  async function patchExtraQuantity(extraId: string, newQuantity: number, prevQuantity: number) {
    patchOrderExtra(order.id, extraId, { quantity: newQuantity });
    // Wait for any in-flight add so the PATCH hits the real DB id, not the
    // optimistic tempId (which 404s and produced "Failed to update quantity").
    const realId = await resolveRealExtraId(extraId).catch(() => null);
    if (!realId) {
      // The add itself failed and has already toasted + rolled back. No PATCH.
      return;
    }
    const res = await fetch(`/api/orders/${order.id}/extras/${realId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ quantity: newQuantity }),
    });
    if (!res.ok) {
      patchOrderExtra(order.id, realId, { quantity: prevQuantity });
      toast.error("Failed to update quantity");
    } else {
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      qc.invalidateQueries({ queryKey: ["inventory", locationId] });
      qc.invalidateQueries({ queryKey: ["inventory-low-list"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-count"] });
    }
  }

  async function incrementInventoryItem(item: InventoryItem) {
    const existing = activeExtras.find((e) => e.inventory_item_id === item.id);
    if (existing) {
      await patchExtraQuantity(existing.id, existing.quantity + 1, existing.quantity);
    } else {
      await addExtraItem({
        name:              item.name,
        price:             item.selling_price,
        cost_price:        item.cost_price,
        quantity:          1,
        inventory_item_id: item.id,
      });
    }
  }

  async function decrementInventoryItem(inventoryItemId: string) {
    const existing = activeExtras.find((e) => e.inventory_item_id === inventoryItemId);
    if (!existing) return;
    if (existing.quantity > 1) {
      await patchExtraQuantity(existing.id, existing.quantity - 1, existing.quantity);
    } else {
      await deleteExtra(existing.id);
    }
  }

  // ─── Extend-from-bill ──────────────────────────────────────────────────────
  // The finished item being billed for the currently-selected table (or any finished
  // item in the order if none matches — multi-table fallback).
  const finishedItem =
    activeItems.find((i) => i.status === "finished" && i.table_id === selectedTableId) ??
    activeItems.find((i) => i.status === "finished") ??
    null;

  const upcomingForFinishedTable = finishedItem
    ? posTables.find((t) => t.id === finishedItem.table_id)?.upcomingBooking ?? null
    : null;

  // Compute today's shop-closing timestamp from "HH:MM" (treats hours <6 as next-day, e.g. 02:00 close)
  const closingMs = (() => {
    const [ch, cm] = closingTime.split(":").map(Number);
    const close = new Date(now);
    close.setHours(ch, cm, 0, 0);
    if (close.getTime() < now.getTime() && ch < 6) {
      close.setDate(close.getDate() + 1);
    }
    return close.getTime();
  })();

  // Max minutes available to extend a finished session — ANCHORED TO expected_end
  // (not to "now"), so brief staff delays after the session ends don't eat into
  // the customer's add-on time. Server enforces the same rule.
  const finishedAnchorMs = finishedItem?.expected_end
    ? new Date(finishedItem.expected_end).getTime()
    : now.getTime();

  const maxExtendMins = (() => {
    if (!finishedItem) return 0;
    const upcomingMs = upcomingForFinishedTable
      ? new Date(upcomingForFinishedTable.scheduled_start).getTime()
      : Infinity;
    const ceilingMs = Math.min(upcomingMs, closingMs);
    return Math.max(0, Math.floor((ceilingMs - finishedAnchorMs) / 60000));
  })();

  const EXTEND_PRESETS = [15, 30, 60];

  async function extendFromBill(mins: number) {
    if (!finishedItem) return;
    // Anchor to expected_end (not now) so 9pm + 30min = 9:30pm, regardless of click time
    const newExpectedEnd = new Date(finishedAnchorMs + mins * 60 * 1000).toISOString();
    // Optimistic: flip back to running so UI reflects it immediately
    patchOrderItem(finishedItem.id, {
      status:       "running",
      actual_end:   null,
      expected_end: newExpectedEnd,
    });
    const res = await fetch("/api/sessions/extend", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ order_item_id: finishedItem.id, extend_mins: mins }),
    });
    const body = await res.json() as
      | { success: true;  data: { new_expected_end: string } }
      | { success: false; error: string };
    if (!body.success) {
      // Revert
      patchOrderItem(finishedItem.id, {
        status:       "finished",
        actual_end:   new Date().toISOString(),
        expected_end: finishedItem.expected_end,
      });
      toast.error(body.error);
    } else {
      patchOrderItem(finishedItem.id, { expected_end: body.data.new_expected_end });
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-[#1f1f1f]">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
            style={{ background: "#D4541A" }}
          >
            {initials(order.customer_name)}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-gray-900 dark:text-white text-sm leading-tight truncate">
              {order.customer_name}
            </p>
            {order.customer_phone && (
              <div className="flex flex-col gap-0.5 mt-0.5">
                <p className="text-xs text-gray-500 dark:text-[#666] truncate font-medium">
                  {order.customer_phone}
                </p>
                {customerInfo && customerInfo.active_memberships && customerInfo.active_memberships.length > 0 && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 w-fit">
                      Member ID: {customerInfo.active_memberships[0].short_id || "Active"}
                    </span>
                    <span className="text-[9px] text-purple-600 dark:text-purple-400 font-semibold">
                      Plans: {customerInfo.active_memberships.map((m: any) => m.plan?.name).join(", ")}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          <span
            className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ml-1"
            style={
              order.type === "walk_in"
                ? { background: "rgba(212,84,26,0.1)", color: "#D4541A" }
                : { background: "rgba(139,92,246,0.1)", color: "#a78bfa" }
            }
          >
            {order.type === "walk_in" ? "Walk-in" : "Online"}
          </span>
        </div>
        <button
          onClick={() => setSelectedTableId(null)}
          className="shrink-0 ml-3 p-1.5 rounded-lg text-gray-400 dark:text-[#555] hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-w-0">

        {/* Session cards */}
        {activeItems.map((item) => {
          const isRunning  = item.status === "running";
          const lineBill   = calculateBill([item], [], now).subtotal;
          const tableName  = (item.table as { name?: string } | null)?.name ?? "Table";
          const tableInStore   = posTables.find((t) => t.id === item.table_id);
          const upcomingForItem = tableInStore?.upcomingBooking ?? null;
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
          const bookingBoundaryMs = upcomingForItem
            ? new Date(upcomingForItem.scheduled_start).getTime()
            : Infinity;
          const ceilingMs = Math.min(closingMs, bookingBoundaryMs);
          const maxExtendMins = Math.max(0, Math.floor((ceilingMs - anchorMs) / 60000));

          // Extend allowed if there is at least 15 min available
          const canExtend      = maxExtendMins >= 15;
          const hasNextBooking = !!upcomingForItem;

          let countdown = "";
          let isOvertime = false;
          if (isRunning && item.expected_end) {
            const exp    = new Date(item.expected_end);
            const signed = formatSignedCountdown(exp, now);
            countdown    = signed.text;
            isOvertime   = signed.isOvertime;
          }

          const progressPct =
            isRunning && item.actual_start && item.expected_end && !isOvertime
              ? Math.min(100, Math.max(0,
                  (now.getTime() - new Date(item.actual_start).getTime()) /
                  (new Date(item.expected_end).getTime() - new Date(item.actual_start).getTime()) * 100
                ))
              : 0;

          return (
            <div
              key={item.id}
              className={`rounded-2xl p-4 space-y-3 bg-white dark:bg-[#0d0d0d] shadow-sm ${
                isRunning
                  ? isOvertime
                    ? "border-2 border-red-400 dark:border-[rgba(239,68,68,0.45)]"
                    : "border-2 border-emerald-400 dark:border-[rgba(16,185,129,0.45)]"
                  : "border border-gray-200 dark:border-[#262626]"
              }`}
            >
              {/* Top row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <p className="font-bold text-gray-900 dark:text-white text-base">{tableName}</p>
                  {isRunning && (
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide"
                      style={
                        isOvertime
                          ? { background: "rgba(239,68,68,0.15)", color: "#ef4444" }
                          : { background: "rgba(16,185,129,0.15)", color: "#10b981" }
                      }
                    >
                      {isOvertime ? "Over time" : "Live"}
                    </span>
                  )}
                  {item.status === "finished" && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide bg-gray-200 dark:bg-[#222] text-gray-600 dark:text-[#aaa]">
                      Finished
                    </span>
                  )}
                  {item.status === "scheduled" && (
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide"
                      style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}
                    >
                      Scheduled
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p
                    className="font-bold text-lg tabular-nums"
                    style={{ color: isRunning ? "#D4541A" : undefined }}
                  >
                    {formatCurrency(lineBill)}
                  </p>
                  <p className="text-[11px] mt-0.5 text-gray-500 dark:text-[#888]">
                    ₹{item.rate_per_hour}/hr
                  </p>
                </div>
              </div>

              {/* Players / controllers — only when the table has tiered pricing
                  AND the session is still adjustable (not yet finalized). */}
              {(item.status === "running" || item.status === "scheduled") &&
                ((item.table?.people_pricing && Object.keys(item.table.people_pricing).length > 0) ||
                 (item.table && isSimulatorTable(item.table))) && (
                  <PeoplePicker item={item} locationId={locationId} />
              )}


              {/* Bill-ready: show full session timings (Started → Ended) */}
              {item.status === "finished" && (
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-[#0a0a0a] border border-gray-200 dark:border-[#222]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-gray-600 dark:text-[#aaa] uppercase tracking-wide">
                      Started
                    </span>
                    <span className="text-sm font-mono font-bold tabular-nums text-gray-900 dark:text-white">
                      {item.actual_start ? fmtTime(item.actual_start) : "—"}
                    </span>
                  </div>
                  <span className="text-gray-400 dark:text-[#666] text-xs">→</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-gray-600 dark:text-[#aaa] uppercase tracking-wide">
                      Ended
                    </span>
                    <span className="text-sm font-mono font-bold tabular-nums text-gray-900 dark:text-white">
                      {item.actual_end ? fmtTime(item.actual_end) : item.expected_end ? fmtTime(item.expected_end) : "—"}
                    </span>
                  </div>
                </div>
              )}

              {/* Start time + countdown / overtime */}
              {isRunning && (
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-[#0a0a0a] border border-gray-200 dark:border-[#222]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-gray-500 dark:text-[#999] uppercase tracking-wide">
                      Started
                    </span>
                    <span className="text-sm font-mono font-bold tabular-nums text-gray-900 dark:text-white">
                      {item.actual_start ? fmtTime(item.actual_start) : "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: isOvertime ? "#ef4444" : "#999" }}
                    >
                      {isOvertime ? "Over" : "Left"}
                    </span>
                    <span
                      className="text-sm font-mono font-bold tabular-nums"
                      style={{ color: isOvertime ? "#ef4444" : "#D4541A" }}
                    >
                      {countdown}
                    </span>
                  </div>
                </div>
              )}

              {/* Progress bar */}
              {isRunning && (progressPct > 0 || isOvertime) && (
                <div className="h-1.5 rounded-full overflow-hidden bg-gray-100 dark:bg-[#1A1A1A]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width:      isOvertime ? "100%" : `${progressPct}%`,
                      background: isOvertime ? "#ef4444" : progressPct > 85 ? "#f59e0b" : "#10b981",
                      transition: "width 1s linear",
                    }}
                  />
                </div>
              )}

              {/* Actions */}
              {isRunning && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setStopConfirmItem(item)}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-white text-xs font-bold transition-colors hover:bg-red-500"
                    style={{ background: "#ef4444" }}
                  >
                    <Square className="h-3 w-3 fill-current" /> Stop
                  </button>
                  {canExtend && (
                    <button
                      onClick={() => setExtendModal(item)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors
                        bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
                        text-gray-600 dark:text-[#888] hover:text-gray-900 dark:hover:text-white hover:border-gray-400"
                    >
                      <Timer className="h-3 w-3" /> Extend
                    </button>
                  )}
                </div>
              )}

              {item.status === "scheduled" && (
                <button
                  className="w-full py-2 rounded-lg text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors hover:bg-emerald-400"
                  style={{ background: "#10b981" }}
                  onClick={async () => {
                    const startTime = new Date().toISOString();
                    patchOrderItem(item.id, { status: "running", actual_start: startTime });
                    const res = await fetch("/api/sessions/start", {
                      method:  "POST",
                      headers: { "Content-Type": "application/json" },
                      body:    JSON.stringify({ order_item_id: item.id }),
                    });
                    if (!res.ok) {
                      const body = await res.json() as { error?: string };
                      patchOrderItem(item.id, { status: "scheduled", actual_start: null });
                      toast.error(body.error ?? "Failed to start session");
                    } else {
                      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
                    }
                  }}
                >
                  Start Session
                </button>
              )}
            </div>
          );
        })}

        {/* Extras — catalogue & custom both behind toggles. Default closed. */}
        <div className="rounded-2xl overflow-hidden bg-white dark:bg-[#0d0d0d] border border-gray-200 dark:border-[#222] shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#222]">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-700 dark:text-[#ccc]">
              Extras
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCatalogueOpen((v) => !v)}
                className="flex items-center gap-1 text-xs font-semibold transition-colors hover:brightness-75"
                style={{ color: "#D4541A" }}
              >
                <Plus className="h-3.5 w-3.5" /> {catalogueOpen ? "Hide items" : "Extra items"}
              </button>
            </div>
          </div>

          {/* Catalogue — only shown when toggled open */}
          {catalogueOpen && (
            <div className="p-3 space-y-1.5 max-h-72 overflow-y-auto border-b border-gray-100 dark:border-[#1f1f1f]">
              {(inventoryItems ?? []).length === 0 && (
                <p className="text-xs text-gray-400 dark:text-[#666] py-3 text-center">
                  No items in catalogue
                </p>
              )}
              {(inventoryItems ?? []).map((item) => {
                const existing = activeExtras.find((e) => e.inventory_item_id === item.id);
                const qty      = existing?.quantity ?? 0;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg
                      bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#262626]"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{item.name}</p>
                      <p className="text-xs text-gray-500 dark:text-[#999]">₹{item.selling_price}</p>
                    </div>
                    {qty === 0 ? (
                      <button
                        onClick={() => incrementInventoryItem(item)}
                        className="text-xs font-bold px-3.5 py-1.5 rounded-md text-white transition-opacity hover:opacity-85"
                        style={{ background: "#D4541A" }}
                      >
                        ADD
                      </button>
                    ) : (
                      <div
                        className="flex items-center rounded-md overflow-hidden"
                        style={{ border: "1.5px solid #D4541A" }}
                      >
                        <button
                          onClick={() => decrementInventoryItem(item.id)}
                          className="w-8 h-8 flex items-center justify-center text-base font-bold transition-colors
                            hover:bg-orange-50 dark:hover:bg-[#2a1300]"
                          style={{ color: "#D4541A" }}
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span
                          className="w-7 text-center text-sm font-bold tabular-nums"
                          style={{ color: "#D4541A" }}
                        >
                          {qty}
                        </span>
                        <button
                          onClick={() => incrementInventoryItem(item)}
                          className="w-8 h-8 flex items-center justify-center text-base font-bold transition-colors
                            hover:bg-orange-50 dark:hover:bg-[#2a1300]"
                          style={{ color: "#D4541A" }}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Catalogue items already added — summary list (always visible if any) */}
          {groupedExtras.filter((e) => e.inventory_item_id).length > 0 && (
            <div className="px-3 py-2 space-y-1 border-b border-gray-100 dark:border-[#1f1f1f]">
              {groupedExtras
                .filter((e) => e.inventory_item_id)
                .map((extra) => (
                  <div key={extra.id} className="flex items-center justify-between py-0.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-gray-800 dark:text-[#ddd] truncate">{extra.name}</span>
                      <span className="text-xs shrink-0 text-gray-500 dark:text-[#999]">×{extra.quantity}</span>
                    </div>
                    <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                      {formatCurrency(extra.price * extra.quantity)}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {/* Custom items list — only shown if any non-catalogue extras exist */}
          {groupedExtras.some((e) => !e.inventory_item_id) && (
            <div className="border-b border-gray-100 dark:border-[#1f1f1f] px-3 pt-2 pb-3 space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-[#888] mb-1">
                Custom items
              </p>
              {groupedExtras
                .filter((e) => !e.inventory_item_id)
                .map((extra) => (
                  <div key={extra.id} className="flex items-center justify-between py-1 px-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-gray-900 dark:text-white truncate">{extra.name}</span>
                      <span className="text-xs shrink-0 text-gray-500 dark:text-[#999]">×{extra.quantity}</span>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">
                        {formatCurrency(extra.price * extra.quantity)}
                      </span>
                      <button
                        onClick={() => deleteExtra(extra.ids[extra.ids.length - 1])}
                        className="text-gray-400 hover:text-red-400 transition-colors"
                        aria-label="Remove custom item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}

        </div>

        <div className="h-2" />
      </div>

      {/* Pinned bill footer */}
      <div className="shrink-0 bg-white dark:bg-[#111] border-t border-gray-200 dark:border-[#222]">
        <div className="px-5 pt-3 pb-1 max-h-36 overflow-y-auto space-y-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-gray-600 dark:text-[#aaa] mb-2">
            Receipt
          </p>
          {bill.tableLines.map((line) => {
            const ti = activeItems.find((i) => i.id === line.id);
            const tn = (ti?.table as { name?: string } | null)?.name ?? "Table";
            return (
              <div key={line.id} className="flex justify-between items-baseline gap-2 py-0.5">
                <span className="truncate text-sm font-medium text-gray-800 dark:text-[#ddd]">
                  {tn} · {line.durationMins}m
                </span>
                <span className="shrink-0 font-bold text-gray-900 dark:text-white tabular-nums text-sm">
                  {formatCurrency(line.amount)}
                </span>
              </div>
            );
          })}
          {bill.extraLines.map((line) => (
            <div key={line.id} className="flex justify-between items-baseline gap-2 py-0.5">
              <span className="truncate text-sm font-medium text-gray-800 dark:text-[#ddd]">
                {line.name} ×{line.quantity}
              </span>
              <span className="shrink-0 font-bold text-gray-900 dark:text-white tabular-nums text-sm">
                {formatCurrency(line.amount)}
              </span>
            </div>
          ))}
          {bill.discountAmount > 0 && (
            <div className="flex justify-between items-baseline gap-2 py-0.5">
              <span className="text-xs font-semibold" style={{ color: "#10b981" }}>Coupon Discount</span>
              <span className="text-xs font-semibold tabular-nums" style={{ color: "#10b981" }}>
                −{formatCurrency(bill.discountAmount)}
              </span>
            </div>
          )}
          {bill.freeHoursDiscountAmount > 0 && (
            <div className="flex justify-between items-baseline gap-2 py-0.5">
              <span className="text-xs font-semibold" style={{ color: "#8b5cf6" }}>Membership (Free Hours)</span>
              <span className="text-xs font-semibold tabular-nums" style={{ color: "#8b5cf6" }}>
                −{formatCurrency(bill.freeHoursDiscountAmount)}
              </span>
            </div>
          )}
          {bill.memberDiscountAmount > 0 && (
            <div className="flex justify-between items-baseline gap-2 py-0.5">
              <span className="text-xs font-semibold" style={{ color: "#8b5cf6" }}>Member Discount ({customerInfo?.membership_discount_pct}% Off)</span>
              <span className="text-xs font-semibold tabular-nums" style={{ color: "#8b5cf6" }}>
                −{formatCurrency(bill.memberDiscountAmount)}
              </span>
            </div>
          )}
          {bill.advancePaid > 0 && (
            <div className="flex justify-between items-baseline gap-2 py-0.5">
              <span className="text-xs font-semibold" style={{ color: "#10b981" }}>Advance paid</span>
              <span className="text-xs font-semibold tabular-nums" style={{ color: "#10b981" }}>
                −{formatCurrency(bill.advancePaid)}
              </span>
            </div>
          )}
          {clampedRedeem > 0 && (
            <div className="flex justify-between items-baseline gap-2 py-0.5">
              <span className="text-xs font-semibold" style={{ color: "#f59e0b" }}>Points ({clampedRedeem} pts)</span>
              <span className="text-xs font-semibold tabular-nums" style={{ color: "#f59e0b" }}>
                −{formatCurrency(clampedRedeem * redeemRate)}
              </span>
            </div>
          )}
        </div>

        {/* Loyalty points row — only when bill is ready and customer has >= minPointsToRedeem pts */}
        {!hasRunning && order.customer_phone && customerInfo && customerInfo.points_balance >= minPointsToRedeem && (
          <div className="px-5 py-2.5 border-t border-gray-100 dark:border-[#1a1a1a] flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Star className="h-3.5 w-3.5 shrink-0" style={{ color: "#f59e0b" }} />
              <span className="text-xs font-semibold text-gray-700 dark:text-[#ccc] flex-1">
                {customerInfo.points_balance} pts
              </span>
              <input
                type="number"
                min="0"
                max={maxRedeem}
                value={redeemInput}
                onChange={(e) => handleRedeemChange(e.target.value)}
                placeholder="0"
                className="w-16 text-xs font-semibold rounded-lg px-2 py-1 outline-none text-center tabular-nums
                  bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
                  text-gray-900 dark:text-white focus:border-[#f59e0b]"
              />
              <span className="text-xs font-medium text-gray-500 dark:text-[#999] shrink-0">/ {maxRedeem} max</span>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-[#555] pl-5">
              Requires min. balance of {minPointsToRedeem} pts to redeem.
            </p>
          </div>
        )}

        <div className="px-5 pb-5 pt-3 border-t border-gray-100 dark:border-[#1a1a1a]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-[#bbb]">
              Total due
            </span>
            <span className="text-3xl font-extrabold tabular-nums leading-none" style={{ color: "#D4541A" }}>
              {formatCurrency(hasRunning ? bill.totalDue : displayTotal)}
            </span>
          </div>

          {/* Extend-from-bill — only when bill is ready (session finished) */}
          {!hasRunning && finishedItem && (
            <div className="mb-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:text-[#bbb] mb-1.5">
                Add more time
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {EXTEND_PRESETS.map((mins) => {
                  const blocked = mins > maxExtendMins;
                  return (
                    <button
                      key={mins}
                      onClick={() => extendFromBill(mins)}
                      disabled={blocked}
                      title={
                        blocked
                          ? upcomingForFinishedTable && new Date(upcomingForFinishedTable.scheduled_start).getTime() < closingMs
                            ? "Next booking too close"
                            : "Past closing time"
                          : `Resume session for ${mins} more minutes`
                      }
                      className={`py-2 rounded-lg text-xs font-bold transition-all ${
                        blocked
                          ? "bg-gray-50 dark:bg-[#0d0d0d] text-gray-300 dark:text-[#333] cursor-not-allowed line-through"
                          : "bg-gray-100 dark:bg-[#1a1a1a] text-gray-700 dark:text-white border border-gray-200 dark:border-[#2a2a2a] hover:border-[#D4541A] hover:text-[#D4541A] cursor-pointer"
                      }`}
                    >
                      +{mins}m
                    </button>
                  );
                })}
              </div>
              {maxExtendMins === 0 && (
                <p className="text-xs mt-1.5 text-gray-500 dark:text-[#999]">
                  {upcomingForFinishedTable ? "Next booking too close to extend" : "Shop closing — extension unavailable"}
                </p>
              )}
            </div>
          )}

          <button
            onClick={() => setFinalizeId(order.id)}
            disabled={hasRunning}
            className={`w-full py-3.5 rounded-xl text-base font-bold transition-opacity ${
              hasRunning
                ? "bg-gray-100 dark:bg-[#1a1a1a] text-gray-400 dark:text-[#555] cursor-not-allowed"
                : "text-white hover:brightness-110 active:brightness-95 cursor-pointer shadow-lg"
            }`}
            style={hasRunning ? {} : { background: "#D4541A", boxShadow: "0 6px 20px rgba(212,84,26,0.35)" }}
          >
            {hasRunning ? "Stop sessions first" : "Finalize & Collect"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

function ContextPanelInner({ locationId, closingTime }: { locationId: string; closingTime: string }) {
  const tables          = usePOSStore((s) => s.tables);
  const openOrders      = usePOSStore((s) => s.openOrders);
  const selectedTableId = usePOSStore((s) => s.selectedTableId);

  const table = tables.find((t) => t.id === selectedTableId) ?? null;
  if (!table) return null;

  const item      = table.activeOrderItem;
  const isRunning = !!item && item.status === "running";
  const isBillReady = !!item && item.status === "finished";

  const runningOrder = isRunning
    ? openOrders.find((o) => o.items.some((i) => i.id === item!.id))
    : null;

  const billReadyOrder = isBillReady
    ? openOrders.find((o) => o.items.some((i) => i.id === item!.id))
    : null;

  const minsUntilBooking = table.upcomingBooking
    ? (new Date(table.upcomingBooking.scheduled_start).getTime() - Date.now()) / 60000
    : Infinity;
  const isBooked = !isRunning && !isBillReady && !!table.upcomingBooking && minsUntilBooking <= 30;
  const isIdle   = !isRunning && !isBillReady && !isBooked;

  // Booked tables: actions live on the card — no panel needed
  if (isBooked) return null;

  if (isIdle)                        return <PanelWalkIn  locationId={locationId} table={table} />;
  if (isRunning && runningOrder)     return <PanelSession locationId={locationId} order={runningOrder} closingTime={closingTime} />;
  if (isBillReady && billReadyOrder) return <PanelSession locationId={locationId} order={billReadyOrder} closingTime={closingTime} />;

  return null;
}

export const ContextPanel = memo(ContextPanelInner);
