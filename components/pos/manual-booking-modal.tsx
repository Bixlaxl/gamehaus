"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarPlus, Banknote, Smartphone, CheckCircle, Gamepad2, Clock, AlertTriangle } from "lucide-react";
import type { Table, TableMode } from "@/lib/supabase/types";
import { isSimulatorActive, isSimulatorTable, addOneDay } from "@/lib/utils";


interface Props {
  locationId: string;
  /** Default date to seed the form with (yyyy-mm-dd in local tz). */
  defaultDate?: string;
  onClose:   () => void;
  /** Fires after a successful create so the parent can refetch its list. */
  onCreated: () => void;
}

function todayLocalDateStr(): string {
  const d = new Date();
  // local-tz yyyy-mm-dd
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().split("T")[0];
}

export function ManualBookingModal({ locationId, defaultDate, onClose, onCreated }: Props) {
  const qc = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);
  const [name,  setName]  = useState("");

  type CustomerSuggestion = { phone: string; name: string | null; visit_count: number; points_balance: number };
  const [nameSuggestions, setNameSuggestions] = useState<CustomerSuggestion[]>([]);
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const nameSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameSearchAbort = useRef<AbortController | null>(null);

  function handleNameChange(val: string) {
    const cleaned = val.replace(/[^a-zA-Z\s]/g, "");
    setName(cleaned);

    if (nameSearchTimer.current) clearTimeout(nameSearchTimer.current);
    if (nameSearchAbort.current) nameSearchAbort.current.abort();

    const q = cleaned.trim();
    if (q.length < 2) {
      setNameSuggestions([]);
      setShowNameSuggestions(false);
      return;
    }

    nameSearchTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      nameSearchAbort.current = controller;
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const body = await res.json() as
          | { success: true; data: CustomerSuggestion[] }
          | { success: false; error: string };
        if (body.success) {
          setNameSuggestions(body.data);
          setShowNameSuggestions(body.data.length > 0);
        }
      } catch {
        // Aborted or network — silent
      }
    }, 300);
  }

  function pickSuggestion(s: CustomerSuggestion) {
    setName(s.name || "");
    setPhone(s.phone);
    setIsRegistered(true);
    setShowNameSuggestions(false);
    setNameSuggestions([]);
  }
  const [phone, setPhone] = useState("");
  const [tableId, setTableId] = useState("");
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [date,    setDate]    = useState(defaultDate ?? todayLocalDateStr());
  const [time,    setTime]    = useState("18:00");
  const [duration, setDuration] = useState(60);
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceMethod, setAdvanceMethod] = useState<"cash" | "upi" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isRegistered, setIsRegistered] = useState(false);
  const [lookingUpPhone, setLookingUpPhone] = useState(false);

  function validateForm() {
    if (!name.trim()) { setError("Customer name is required"); return false; }
    if (!/^\d{10}$/.test(phone.trim())) { setError("Phone must be exactly 10 digits"); return false; }
    if (!tableId) { setError("Pick a table"); return false; }
    if (!chosenTable) { setError("Selected table not found"); return false; }
    if (slotConflict) { setError("Selected time window overlaps with an existing booking"); return false; }
    const advanceNum = parseFloat(advanceAmount);
    const wantAdvance = !!advanceAmount && Number.isFinite(advanceNum) && advanceNum > 0;
    if (wantAdvance && !advanceMethod) { setError("Pick cash or UPI for the advance"); return false; }
    return true;
  }

  // Customer phone lookup & autofill
  useEffect(() => {
    if (phone.length === 10) {
      setLookingUpPhone(true);
      fetch(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`)
        .then((res) => res.json())
        .then((data: { found: boolean; customer: { name: string | null } | null }) => {
          if (data.found && data.customer?.name) {
            setName(data.customer.name);
            setIsRegistered(true);
            toast.success(`Registered customer: ${data.customer.name}`);
          } else {
            setIsRegistered(false);
          }
        })
        .catch(() => {})
        .finally(() => setLookingUpPhone(false));
    } else {
      setIsRegistered(false);
    }
  }, [phone]);

  // Load this location's tables for the picker
  const { data: tables = [] } = useQuery<Table[]>({
    queryKey: ["manual-booking-tables", locationId],
    queryFn: async () => {
      const res = await fetch(`/api/tables?location_id=${locationId}`, { cache: "no-store" });
      const body = await res.json() as { success: true; data: Table[] } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data.filter((t) => t.is_active);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Default-pick the first available table once tables load
  useEffect(() => {
    if (!tableId && tables.length > 0) setTableId(tables[0].id);
  }, [tables, tableId]);

  const chosenTable = useMemo(() => tables.find((t) => t.id === tableId), [tables, tableId]);

  // Load location opening/closing times
  const { data: locationInfo } = useQuery<{ opening_time: string; closing_time: string }>({
    queryKey: ["location-info-detail", locationId],
    queryFn: async () => {
      const res = await fetch("/api/locations", { cache: "no-store" });
      const body = await res.json();
      const list = body.success ? body.data : [];
      const found = list.find((l: any) => l.id === locationId);
      return found ? { opening_time: found.opening_time, closing_time: found.closing_time } : { opening_time: "10:00", closing_time: "23:00" };
    },
    staleTime: 10 * 60 * 1000,
  });

  // Load blocked slots for selected table and date (refetches every 5s for live updates)
  const { data: blockedSlots = [], isLoading: slotsLoading } = useQuery<{ start: string; end: string }[]>({
    queryKey: ["manual-table-slots", tableId, date],
    queryFn: async () => {
      if (!tableId || !date) return [];
      const res = await fetch(`/api/tables/${tableId}/slots?date=${date}`, { cache: "no-store" });
      const body = await res.json();
      return body.success ? body.data : [];
    },
    enabled: !!tableId && !!date,
    refetchInterval: 5000,
  });

  // Handle modes for multi-mode tables
  const tableModes = useMemo(() => {
    if (chosenTable?.modes && Array.isArray(chosenTable.modes) && chosenTable.modes.length > 0) {
      return chosenTable.modes as TableMode[];
    }
    return [];
  }, [chosenTable]);

  useEffect(() => {
    if (tableModes.length > 0) {
      setSelectedModeId(tableModes[0].id);
    } else {
      setSelectedModeId(null);
    }
  }, [tableModes]);

  const selectedMode = useMemo(() => {
    if (tableModes.length === 0 || !selectedModeId) return null;
    return tableModes.find((m) => m.id === selectedModeId) ?? null;
  }, [tableModes, selectedModeId]);

  const isSimulator = chosenTable ? isSimulatorActive(chosenTable, selectedMode) : false;
  const durationPresets = useMemo(() => {
    return [
      { mins: 15,  label: "15m" },
      { mins: 30,  label: "30m" },
      { mins: 60,  label: "1h"  },
      { mins: 90,  label: "1.5h" },
      { mins: 120, label: "2h"  },
      { mins: 180, label: "3h"  },
    ];
  }, []);

  // Default-pick num_people to the table/mode's smallest tier
  const peopleOptions = useMemo(() => {
    if (selectedMode) {
      if (selectedMode.people_pricing && typeof selectedMode.people_pricing === "object") {
        const dbKeys = Object.keys(selectedMode.people_pricing)
          .filter((k) => Boolean(selectedMode.people_pricing![k]))
          .sort((a, b) => Number(a) - Number(b));
        if (dbKeys.length > 0) return dbKeys;
      }
      if (selectedMode.pricing_basis === "controller") return ["1", "2"];
      if (selectedMode.pricing_basis === "player") return ["1", "2", "3", "4"];
      return [];
    }
    if (!chosenTable) return [];
    if (isSimulatorTable(chosenTable)) {
      if (chosenTable.people_pricing && typeof chosenTable.people_pricing === "object") {
        const dbKeys = Object.keys(chosenTable.people_pricing)
          .filter((k) => Boolean(chosenTable.people_pricing![k]))
          .sort((a, b) => Number(a) - Number(b));
        if (dbKeys.length > 0) return dbKeys;
      }
      return ["1", "2"];
    }
    if (!chosenTable.people_pricing) return [];
    return Object.keys(chosenTable.people_pricing).sort((a, b) => Number(a) - Number(b));
  }, [chosenTable, selectedMode]);

  const [numPeople, setNumPeople] = useState<string | null>(null);
  useEffect(() => {
    setNumPeople(peopleOptions[0] ?? null);
  }, [tableId, selectedModeId, peopleOptions]);

  const effectiveRate = (() => {
    if (selectedMode) {
      if (numPeople && selectedMode.people_pricing?.[numPeople]) {
        return selectedMode.people_pricing[numPeople];
      }
      return selectedMode.hourly_rate;
    }
    if (!chosenTable) return 0;
    if (numPeople && chosenTable.people_pricing?.[numPeople]) {
      return chosenTable.people_pricing[numPeople];
    }
    if (isSimulatorTable(chosenTable)) {
      const factor = numPeople ? Math.max(1, Number(numPeople)) : 1;
      return chosenTable.hourly_rate * factor;
    }
    return chosenTable.hourly_rate;
  })();

  const estimatedTotal = Math.round((duration / 60) * effectiveRate);

  // Generate slots grid for visual picking
  const slotPills = useMemo(() => {
    const opening = locationInfo?.opening_time ?? "10:00";
    const closing = locationInfo?.closing_time ?? "23:00";
    const [oh, om] = opening.split(":").map(Number);
    const [ch, cm] = closing.split(":").map(Number);
    let openMins = oh * 60 + om;
    let closeMins = ch * 60 + cm;
    if (closeMins <= openMins) closeMins += 24 * 60;

    const stepMins = 15;

    const isToday = date === todayLocalDateStr();
    const nowMs = Date.now();
    // Allow slots starting within 5 minutes ago so current boundary is selectable
    const minStartMs = isToday ? nowMs - 5 * 60 * 1000 : 0;

    const list: { timeStr: string; label: string; isBlocked: boolean; startIso: string; endIso: string }[] = [];
    for (let m = openMins; m < closeMins; m += stepMins) {
      const isNextDay = m >= 24 * 60;
      const norm = m % (24 * 60);
      const hh = String(Math.floor(norm / 60)).padStart(2, "0");
      const mm = String(norm % 60).padStart(2, "0");
      const timeStr = `${hh}:${mm}`;

      const slotDate = isNextDay ? addOneDay(date) : date;
      const slotStartMs = new Date(`${slotDate}T${timeStr}:00+05:30`).getTime();
      // Skip past slots for today
      if (isToday && slotStartMs < minStartMs) continue;

      const slotWindowEndMs = slotStartMs + duration * 60_000;
      const businessCloseMs = new Date(`${date}T${opening}:00+05:30`).getTime() + (closeMins - openMins) * 60_000;
      if (slotWindowEndMs > businessCloseMs) continue;

      const isBlocked = blockedSlots.some((b) => {
        const bStart = new Date(b.start).getTime();
        const bEnd = new Date(b.end).getTime();
        return slotStartMs < bEnd && slotWindowEndMs > bStart;
      });

      const label = new Date(slotStartMs).toLocaleTimeString("en-IN", {
        hour: "2-digit", minute: "2-digit", hour12: true,
      });

      list.push({
        timeStr,
        label,
        isBlocked,
        startIso: new Date(slotStartMs).toISOString(),
        endIso: new Date(slotWindowEndMs).toISOString(),
      });
    }
    return list;
  }, [locationInfo, date, duration, blockedSlots, chosenTable, selectedMode]);

  // Build the ISO strings from the selected pill
  const selectedPill = useMemo(() => slotPills.find((s) => s.timeStr === time), [slotPills, time]);
  const scheduledStart = selectedPill ? selectedPill.startIso : (date && time ? new Date(`${date}T${time}:00+05:30`).toISOString() : "");
  const scheduledEnd   = selectedPill ? selectedPill.endIso   : (scheduledStart ? new Date(new Date(scheduledStart).getTime() + duration * 60_000).toISOString() : "");

  // Check if current selection has conflict
  const slotConflict = useMemo(() => {
    if (!scheduledStart || !scheduledEnd) return false;
    const reqStart = new Date(scheduledStart).getTime();
    const reqEnd = new Date(scheduledEnd).getTime();
    return blockedSlots.some((b) => {
      const bStart = new Date(b.start).getTime();
      const bEnd = new Date(b.end).getTime();
      return reqStart < bEnd && reqEnd > bStart;
    });
  }, [scheduledStart, scheduledEnd, blockedSlots]);

  // Auto-select first available unblocked time if currently selected time is past or blocked
  useEffect(() => {
    if (slotPills.length > 0) {
      const currentValid = slotPills.find((s) => s.timeStr === time && !s.isBlocked);
      if (!currentValid) {
        const firstAvailable = slotPills.find((s) => !s.isBlocked) ?? slotPills[0];
        if (firstAvailable) setTime(firstAvailable.timeStr);
      }
    }
  }, [slotPills, time]);

  const create = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Customer name is required");
      if (!/^\d{10}$/.test(phone.trim())) throw new Error("Phone must be exactly 10 digits");
      if (!tableId) throw new Error("Pick a table");
      if (!chosenTable) throw new Error("Selected table not found");
      if (slotConflict) throw new Error("Selected time window overlaps with an existing booking");
      const advanceNum = parseFloat(advanceAmount);
      const wantAdvance = !!advanceAmount && Number.isFinite(advanceNum) && advanceNum > 0;
      if (wantAdvance && !advanceMethod) throw new Error("Pick cash or UPI for the advance");

      const res = await fetch("/api/pos/manual-booking", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          location_id:        locationId,
          customer_name:      name.trim(),
          customer_phone:     phone.trim(),
          table_id:           tableId,
          scheduled_start:    scheduledStart,
          scheduled_end:      scheduledEnd,
          rate_per_hour:      effectiveRate,
          num_people:         numPeople ? Number(numPeople) : undefined,
          selected_mode_name: selectedMode?.name ?? undefined,
          advance_paid:       wantAdvance ? { amount: advanceNum, method: advanceMethod } : undefined,
        }),
      });
      const body = await res.json() as { success: true; data: unknown } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    onSuccess: () => {
      toast.success("Manual booking created & WhatsApp sent");
      qc.invalidateQueries({ queryKey: ["owner-bookings"] });
      qc.invalidateQueries({ queryKey: ["pos-bookings"] });
      qc.invalidateQueries({ queryKey: ["staff-bookings"] });
      onCreated();
      setShowConfirm(false);
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });

  if (showConfirm) {
    const startDisplay = selectedPill ? selectedPill.label : time;
    const dateDisplay = new Date(date).toLocaleDateString("en-IN", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden bg-white dark:bg-[#111] border border-gray-200 dark:border-[#2A2A2A]">
          <DialogHeader className="px-6 py-5 border-b border-gray-200 dark:border-[#1F1F1F]">
            <DialogTitle className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
              <CalendarPlus className="h-5 w-5" style={{ color: "#D4541A" }} /> Confirm Booking Details
            </DialogTitle>
          </DialogHeader>

          <div className="px-6 py-6 space-y-6 max-h-[70vh] overflow-y-auto">
            <p className="text-base text-gray-500 dark:text-gray-400 font-extrabold">
              Please double check the booking information before sending the WhatsApp confirmation message to the customer:
            </p>

            <div className="grid grid-cols-1 gap-5 bg-gray-50 dark:bg-[#161616] p-6 rounded-2xl border border-gray-200 dark:border-[#222]">
              <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-150 dark:border-[#222] pb-3 gap-2">
                <span className="text-base font-extrabold text-gray-400">Customer Name</span>
                <span className="text-2xl md:text-3xl font-black text-gray-900 dark:text-white">{name.trim()}</span>
              </div>
              <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-150 dark:border-[#222] pb-3 gap-2">
                <span className="text-base font-extrabold text-gray-400">Phone Number</span>
                <span className="text-2xl md:text-3xl font-black text-gray-950 dark:text-white font-mono">{phone.trim()}</span>
              </div>
              <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-150 dark:border-[#222] pb-3 gap-2">
                <span className="text-base font-extrabold text-gray-400">Selected Table</span>
                <span className="text-2xl md:text-3xl font-black text-gray-950 dark:text-white font-black">
                  {chosenTable?.name} {selectedMode ? `(${selectedMode.name})` : ""}
                </span>
              </div>
              <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-150 dark:border-[#222] pb-3 gap-2">
                <span className="text-base font-extrabold text-gray-400">Date & Start Time</span>
                <span className="text-2xl md:text-3xl font-black text-gray-950 dark:text-white">
                  {dateDisplay} @ {startDisplay}
                </span>
              </div>
              <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-150 dark:border-[#222] pb-3 gap-2">
                <span className="text-base font-extrabold text-gray-400">Duration</span>
                <span className="text-2xl md:text-3xl font-black text-gray-950 dark:text-white">
                  {duration} minutes
                </span>
              </div>
              <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-150 dark:border-[#222] pb-3 gap-2">
                <span className="text-base font-extrabold text-gray-400">Advance Paid</span>
                <span className="text-2xl md:text-3xl font-black text-gray-955 dark:text-white font-mono">
                  {advanceAmount ? `₹${advanceAmount} via ${advanceMethod?.toUpperCase()}` : "No Advance"}
                </span>
              </div>
              <div className="flex flex-col md:flex-row md:items-center justify-between pb-1 gap-2">
                <span className="text-base font-extrabold text-gray-400">Estimated Total Cost</span>
                <span className="text-2xl md:text-3xl font-black text-amber-600 dark:text-amber-400 font-mono">
                  ₹{estimatedTotal}
                </span>
              </div>
            </div>

            {error && (
              <p className="text-sm rounded-md px-3 py-2"
                style={{ background: "rgba(239,68,68,0.07)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.2)" }}>
                {error}
              </p>
            )}
          </div>

          <div className="px-6 py-4 border-t flex justify-end gap-3 bg-gray-50 dark:bg-[#161616] border-gray-200 dark:border-[#1F1F1F]">
            <button
              type="button"
              onClick={() => { setError(null); setShowConfirm(false); }}
              className="h-14 px-6 rounded-xl text-base font-extrabold bg-white dark:bg-[#1f1f1f] text-gray-800 dark:text-gray-100 border border-gray-300 dark:border-[#333] hover:bg-gray-100 dark:hover:bg-[#252525]"
            >
              Back / Edit
            </button>
            <button
              type="button"
              onClick={() => {
                if (create.isPending) return;
                setError(null);
                create.mutate();
              }}
              disabled={create.isPending}
              className="h-14 px-8 rounded-xl text-base font-black text-white bg-[#D4541A] hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {create.isPending ? "Booking..." : "Confirm & Book"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-7xl p-0 gap-0 overflow-hidden bg-white dark:bg-[#111] border border-gray-200 dark:border-[#2A2A2A]">
        <DialogHeader className="px-10 py-8 border-b border-gray-200 dark:border-[#1F1F1F]">
          <DialogTitle className="text-3xl font-black text-gray-900 dark:text-white flex items-center gap-3">
            <CalendarPlus className="h-8 w-8" style={{ color: "#D4541A" }} /> Manual booking
          </DialogTitle>
        </DialogHeader>

        <div className="px-10 py-8 space-y-8 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-lg font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Phone (10 digits)</Label>
                {lookingUpPhone && <span className="text-sm text-gray-400">Looking up…</span>}
              </div>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="9XXXXXXXXX"
                className="h-20 text-3xl px-6 rounded-2xl font-bold"
              />
            </div>
            <div className="space-y-3 relative">
              <div className="flex items-center justify-between">
                <Label className="text-lg font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Customer name</Label>
                {isRegistered && (
                  <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-1 rounded-lg">
                    <CheckCircle className="h-5 w-5" /> Registered
                  </span>
                )}
              </div>
              <Input
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                onFocus={() => { if (nameSuggestions.length > 0) setShowNameSuggestions(true); }}
                onBlur={() => {
                  setTimeout(() => setShowNameSuggestions(false), 150);
                }}
                autoComplete="off"
                placeholder="Full name"
                className="h-20 text-3xl px-6 rounded-2xl font-bold"
              />
              {showNameSuggestions && nameSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1.5 z-20 rounded-xl overflow-hidden shadow-xl bg-white dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#333]">
                  {nameSuggestions.map((s) => (
                    <button
                      key={s.phone}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                      className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-150 dark:hover:bg-[#222] border-b last:border-b-0 border-gray-100 dark:border-[#262626]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-3xl font-black text-gray-900 dark:text-white truncate">
                          {s.name ?? "(no name)"}
                        </p>
                        <p className="text-xl font-extrabold text-gray-650 dark:text-[#ccc] font-mono mt-0.5">{s.phone}</p>
                      </div>
                      <span className="shrink-0 text-sm font-black uppercase tracking-wider px-3.5 py-2 rounded bg-amber-100 text-amber-850 dark:bg-amber-955/40 dark:text-amber-400">
                        {s.visit_count}× · {s.points_balance} pts
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-lg font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Table</Label>
            <select
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              className="flex h-20 w-full rounded-2xl border border-input bg-background px-6 py-4 text-3xl font-bold outline-none focus:border-[#D4541A]"
            >
              {tables.length === 0 && <option value="">Loading…</option>}
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · ₹{t.hourly_rate}/hr
                </option>
              ))}
            </select>
          </div>

          {/* Game Mode Selector for multi-mode tables */}
          {tableModes.length > 0 && (
            <div className="space-y-4 p-6 rounded-2xl bg-orange-50/50 border border-orange-200/60 dark:bg-orange-950/10 dark:border-orange-900/30">
              <Label className="text-lg font-extrabold text-orange-900 dark:text-orange-300 uppercase tracking-wider flex items-center gap-2">
                <Gamepad2 className="h-5 w-5" /> Select Game Mode
              </Label>
              <div className="grid grid-cols-2 gap-4">
                {tableModes.map((m) => {
                  const active = selectedModeId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedModeId(m.id)}
                      className={`p-5 rounded-2xl text-left transition-all ${
                        active
                          ? "bg-[#D4541A] text-white shadow-sm font-black border-2 border-[#D4541A]"
                          : "bg-white dark:bg-[#1f1f1f] text-gray-700 dark:text-[#ccc] border border-gray-200 dark:border-gray-800 hover:border-orange-300"
                      }`}
                    >
                      <p className="text-2xl font-black leading-tight">{m.name}</p>
                      <p className={`text-sm mt-1 font-extrabold ${active ? "text-orange-100" : "text-gray-500 dark:text-[#888]"}`}>
                        ₹{m.hourly_rate}/hr
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {peopleOptions.length > 0 && (
            <div className="space-y-3">
              <Label className="text-lg font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                {selectedMode?.pricing_basis === "controller" || chosenTable?.type === "ps5"
                  ? "Controllers"
                  : "Players"}
              </Label>
              <div className="flex flex-wrap gap-4">
                {peopleOptions.map((n, idx) => {
                  const num = Number(n);
                  let active = numPeople === n;
                  let labelText = n;

                  if (idx === 0 && num > 1) {
                    labelText = `1-${n}`;
                    active = numPeople !== null && Number(numPeople) <= num;
                  }

                  const rate = selectedMode
                    ? (selectedMode.people_pricing?.[n] ?? selectedMode.hourly_rate)
                    : (chosenTable!.people_pricing?.[n] ?? (isSimulator && n === "2" ? chosenTable!.hourly_rate * 2 : chosenTable!.hourly_rate));
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNumPeople(n)}
                      className={`px-8 py-5 rounded-2xl text-xl font-black transition-colors ${
                        active
                          ? "bg-[#D4541A] text-white"
                          : "bg-gray-150 dark:bg-[#1a1a1a] text-gray-700 dark:text-[#ccc] hover:bg-gray-200"
                      }`}
                    >
                      {labelText} · ₹{rate}/hr
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-3">
              <Label className="text-lg font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-20 text-3xl px-6 rounded-2xl font-bold" />
            </div>
            <div className="space-y-3">
              <Label className="text-lg font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Start time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} step={900} className="h-20 text-3xl px-6 rounded-2xl font-bold" />
            </div>
          </div>

          {/* Interactive Available Slots Visual Grid */}
          <div className="space-y-4 p-6 rounded-2xl bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <Label className="text-xl font-black flex items-center gap-2 text-gray-900 dark:text-white">
                <Clock className="h-6 w-6 text-[#D4541A]" /> Table Slots Grid
              </Label>
              <span className="text-sm font-extrabold text-gray-400">
                {slotsLoading ? "Checking slots…" : `${slotPills.filter(s => !s.isBlocked).length} available`}
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4 max-h-60 overflow-y-auto pr-1">
              {slotPills.map((s) => {
                const isSelected = time === s.timeStr;
                return (
                  <button
                    key={s.timeStr}
                    type="button"
                    disabled={s.isBlocked}
                    onClick={() => setTime(s.timeStr)}
                    className={`py-5 px-3 rounded-2xl text-xl font-mono font-black transition-all text-center ${
                      isSelected
                        ? "bg-[#D4541A] text-white shadow-md border-2 border-[#D4541A]"
                        : s.isBlocked
                        ? "bg-red-50 dark:bg-red-950/20 text-red-400 dark:text-red-400/60 border border-red-200/50 dark:border-red-900/30 line-through opacity-60 cursor-not-allowed"
                        : "bg-white dark:bg-[#222] text-gray-800 dark:text-[#ddd] border border-gray-200 dark:border-gray-700 hover:border-[#D4541A]"
                    }`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conflict Warning */}
          {slotConflict && (
            <div className="rounded-2xl p-5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 flex items-start gap-3 text-red-700 dark:text-red-400 text-base font-semibold">
              <AlertTriangle className="h-6 w-6 shrink-0 mt-0.5" />
              <span>This table already has an active session or booking during this selected time window. Please pick a different slot.</span>
            </div>
          )}

          <div className="space-y-3">
            <Label className="text-lg font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</Label>
            <div className="flex flex-wrap gap-3 items-center">
              {durationPresets.map((p) => (
                <button
                  key={p.mins}
                  type="button"
                  onClick={() => {
                    setDuration(p.mins);
                    setIsCustomDuration(false);
                  }}
                  className={`px-8 py-5 rounded-2xl text-xl font-black transition-colors ${
                    duration === p.mins && !isCustomDuration
                      ? "bg-[#D4541A] text-white font-black"
                      : "bg-gray-150 dark:bg-[#1a1a1a] text-gray-700 dark:text-[#ccc] hover:bg-gray-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setIsCustomDuration(true)}
                className={`px-8 py-5 rounded-2xl text-xl font-black transition-colors ${
                  isCustomDuration
                    ? "bg-[#D4541A] text-white font-black"
                    : "bg-gray-150 dark:bg-[#1a1a1a] text-gray-700 dark:text-[#ccc] hover:bg-gray-200"
                }`}
              >
                Custom
              </button>

              {isCustomDuration && (
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={1}
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value) || 0)}
                    className="w-40 h-20 text-3xl px-6 rounded-2xl font-bold text-center"
                    placeholder="Mins"
                  />
                  <span className="text-xl font-black text-gray-500 dark:text-gray-400">mins</span>
                </div>
              )}
            </div>
          </div>

          {/* Optional advance */}
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-[#333] p-6 space-y-5">
            <Label className="text-lg font-extrabold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center justify-between">
              <span>Advance taken now (optional)</span>
              <span className="font-extrabold text-gray-400 text-lg">Estimated total ₹{estimatedTotal}</span>
            </Label>
            <div className="flex gap-4 items-center">
              <span className="text-2xl font-black text-gray-400">₹</span>
              <Input
                type="number"
                min={0}
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(e.target.value)}
                placeholder="0"
                className="flex-1 h-20 text-3xl px-6 rounded-2xl font-bold"
              />
              <button
                type="button"
                onClick={() => setAdvanceMethod((m) => m === "cash" ? null : "cash")}
                className={`h-20 px-8 rounded-xl text-lg font-black flex items-center gap-2 transition-all ${
                  advanceMethod === "cash" ? "bg-emerald-100 text-emerald-700 ring-2 ring-emerald-300" : "bg-gray-100 dark:bg-[#1a1a1a] text-gray-700 dark:text-[#ccc]"
                }`}
              >
                <Banknote className="h-6 w-6" /> Cash
              </button>
              <button
                type="button"
                onClick={() => setAdvanceMethod((m) => m === "upi" ? null : "upi")}
                className={`h-20 px-8 rounded-xl text-lg font-black flex items-center gap-2 transition-all ${
                  advanceMethod === "upi" ? "bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300" : "bg-gray-100 dark:bg-[#1a1a1a] text-gray-700 dark:text-[#ccc]"
                }`}
              >
                <Smartphone className="h-6 w-6" /> UPI
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm rounded-md px-3 py-2"
              style={{ background: "rgba(239,68,68,0.07)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.2)" }}>
              {error}
            </p>
          )}
        </div>

        <div className="px-10 py-6 border-t flex justify-end gap-4 bg-gray-50 dark:bg-[#161616] border-gray-200 dark:border-[#1F1F1F]">
          <button
            type="button"
            onClick={onClose}
            className="h-20 px-10 rounded-2xl text-xl font-black bg-white dark:bg-[#1f1f1f] text-gray-800 dark:text-gray-100 border border-gray-300 dark:border-[#333] hover:bg-gray-100 dark:hover:bg-[#252525]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              if (validateForm()) {
                setShowConfirm(true);
              }
            }}
            disabled={create.isPending || slotConflict}
            className="h-20 px-10 rounded-2xl text-xl font-black text-white bg-[#D4541A] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            Create booking
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
