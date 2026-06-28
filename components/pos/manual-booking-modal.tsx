"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [name,  setName]  = useState("");
  const [phone, setPhone] = useState("");
  const [tableId, setTableId] = useState("");
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [date,    setDate]    = useState(defaultDate ?? todayLocalDateStr());
  const [time,    setTime]    = useState("18:00");
  const [duration, setDuration] = useState(60);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceMethod, setAdvanceMethod] = useState<"cash" | "upi" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isRegistered, setIsRegistered] = useState(false);
  const [lookingUpPhone, setLookingUpPhone] = useState(false);

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
    const base = [
      { mins: 30,  label: "30m" },
      { mins: 60,  label: "1h"  },
      { mins: 90,  label: "1.5h" },
      { mins: 120, label: "2h"  },
      { mins: 180, label: "3h"  },
    ];
    if (isSimulator) {
      return [{ mins: 15, label: "15m" }, ...base];
    }
    return base;
  }, [isSimulator]);

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

    const isSim = isSimulatorActive(chosenTable, selectedMode);
    const stepMins = isSim ? 15 : 30;

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
    },
    onError: (e) => setError((e as Error).message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <CalendarPlus className="h-4 w-4" /> Manual booking
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Phone (10 digits)</Label>
                {lookingUpPhone && <span className="text-[10px] text-gray-400">Looking up…</span>}
              </div>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="9XXXXXXXXX"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Customer name</Label>
                {isRegistered && (
                  <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-0.5">
                    <CheckCircle className="h-2.5 w-2.5" /> Registered
                  </span>
                )}
              </div>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z\s]/g, ""))}
                placeholder="Full name"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Table</Label>
            <select
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium"
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
            <div className="space-y-1.5 p-3 rounded-xl bg-orange-50/50 border border-orange-200/60 dark:bg-orange-950/10 dark:border-orange-900/30">
              <Label className="text-xs font-bold text-orange-900 dark:text-orange-300 flex items-center gap-1.5">
                <Gamepad2 className="h-3.5 w-3.5" /> Select Game Mode
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {tableModes.map((m) => {
                  const active = selectedModeId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedModeId(m.id)}
                      className={`p-2.5 rounded-lg text-left transition-all ${
                        active
                          ? "bg-[#D4541A] text-white shadow-sm"
                          : "bg-white dark:bg-[#1f1f1f] text-gray-700 dark:text-[#ccc] border border-gray-200 dark:border-gray-800 hover:border-orange-300"
                      }`}
                    >
                      <p className="text-xs font-bold leading-tight">{m.name}</p>
                      <p className={`text-[10px] mt-0.5 ${active ? "text-orange-100" : "text-gray-500 dark:text-[#888]"}`}>
                        ₹{m.hourly_rate}/hr
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {peopleOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">
                {selectedMode?.pricing_basis === "controller" || chosenTable?.type === "ps5"
                  ? "Controllers"
                  : "Players"}
              </Label>
              <div className="flex flex-wrap gap-2">
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
                      className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                        active
                          ? "bg-[#D4541A] text-white"
                          : "bg-gray-100 dark:bg-[#1a1a1a] text-gray-700 dark:text-[#ccc] hover:bg-gray-200"
                      }`}
                    >
                      {labelText} · ₹{rate}/hr
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Start time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} step={900} />
            </div>
          </div>

          {/* Interactive Available Slots Visual Grid */}
          <div className="space-y-2 p-3 rounded-xl bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold flex items-center gap-1.5 text-gray-900 dark:text-white">
                <Clock className="h-3.5 w-3.5 text-[#D4541A]" /> Table Slots Grid
              </Label>
              <span className="text-[10px] text-gray-400">
                {slotsLoading ? "Checking slots…" : `${slotPills.filter(s => !s.isBlocked).length} available`}
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-36 overflow-y-auto pr-1">
              {slotPills.map((s) => {
                const isSelected = time === s.timeStr;
                return (
                  <button
                    key={s.timeStr}
                    type="button"
                    disabled={s.isBlocked}
                    onClick={() => setTime(s.timeStr)}
                    className={`py-2 px-1.5 rounded-lg text-[11px] font-mono font-bold transition-all text-center ${
                      isSelected
                        ? "bg-[#D4541A] text-white shadow"
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
            <div className="rounded-lg p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 flex items-start gap-2 text-red-700 dark:text-red-400 text-xs font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>This table already has an active session or booking during this selected time window. Please pick a different slot.</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Duration</Label>
            <div className="flex flex-wrap gap-1.5">
              {durationPresets.map((p) => (
                <button
                  key={p.mins}
                  type="button"
                  onClick={() => setDuration(p.mins)}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                    duration === p.mins
                      ? "bg-[#D4541A] text-white"
                      : "bg-gray-100 dark:bg-[#1a1a1a] text-gray-700 dark:text-[#ccc] hover:bg-gray-200"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Optional advance */}
          <div className="rounded-lg border border-dashed p-3 space-y-2">
            <Label className="text-xs flex items-center justify-between">
              <span>Advance taken now (optional)</span>
              <span className="font-normal text-gray-500">Estimated total ₹{estimatedTotal}</span>
            </Label>
            <div className="flex gap-2 items-center">
              <span className="text-sm text-gray-500">₹</span>
              <Input
                type="number"
                min={0}
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(e.target.value)}
                placeholder="0"
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => setAdvanceMethod((m) => m === "cash" ? null : "cash")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1 ${
                  advanceMethod === "cash" ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300" : "bg-gray-100 dark:bg-[#1a1a1a] text-gray-700 dark:text-[#ccc]"
                }`}
              >
                <Banknote className="h-3 w-3" /> Cash
              </button>
              <button
                type="button"
                onClick={() => setAdvanceMethod((m) => m === "upi" ? null : "upi")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1 ${
                  advanceMethod === "upi" ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300" : "bg-gray-100 dark:bg-[#1a1a1a] text-gray-700 dark:text-[#ccc]"
                }`}
              >
                <Smartphone className="h-3 w-3" /> UPI
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

        <div className="px-5 py-3 border-t flex justify-end gap-2 bg-gray-50 dark:bg-[#161616]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-md text-sm font-semibold bg-white dark:bg-[#1f1f1f] border hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { setError(null); create.mutate(); }}
            disabled={create.isPending || slotConflict}
            className="px-4 py-2 rounded-md text-sm font-bold text-white bg-[#D4541A] hover:opacity-90 disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create booking"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
