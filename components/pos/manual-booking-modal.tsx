"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarPlus, Banknote, Smartphone } from "lucide-react";
import type { Table } from "@/lib/supabase/types";

const DURATION_PRESETS = [
  { mins: 30,  label: "30m" },
  { mins: 60,  label: "1h"  },
  { mins: 90,  label: "1.5h" },
  { mins: 120, label: "2h"  },
  { mins: 180, label: "3h"  },
];

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
  const [date,    setDate]    = useState(defaultDate ?? todayLocalDateStr());
  const [time,    setTime]    = useState("18:00");
  const [duration, setDuration] = useState(60);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceMethod, setAdvanceMethod] = useState<"cash" | "upi" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  // Default-pick num_people to the table's smallest tier if it has tiered pricing
  const peopleOptions = chosenTable?.people_pricing
    ? Object.keys(chosenTable.people_pricing).sort((a, b) => Number(a) - Number(b))
    : [];
  const [numPeople, setNumPeople] = useState<string | null>(null);
  useEffect(() => {
    setNumPeople(peopleOptions[0] ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  const effectiveRate = chosenTable
    ? ((numPeople && chosenTable.people_pricing?.[numPeople]) || chosenTable.hourly_rate)
    : 0;
  const estimatedTotal = Math.round((duration / 60) * effectiveRate);

  // Build the ISO strings the server expects (IST local time → ISO with offset)
  const scheduledStart = date && time
    ? new Date(`${date}T${time}:00+05:30`).toISOString()
    : "";
  const scheduledEnd = scheduledStart
    ? new Date(new Date(scheduledStart).getTime() + duration * 60_000).toISOString()
    : "";

  const create = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Customer name is required");
      if (!/^\d{10}$/.test(phone.trim())) throw new Error("Phone must be exactly 10 digits");
      if (!tableId) throw new Error("Pick a table");
      if (!chosenTable) throw new Error("Selected table not found");
      const advanceNum = parseFloat(advanceAmount);
      const wantAdvance = !!advanceAmount && Number.isFinite(advanceNum) && advanceNum > 0;
      if (wantAdvance && !advanceMethod) throw new Error("Pick cash or UPI for the advance");

      const res = await fetch("/api/pos/manual-booking", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          location_id:     locationId,
          customer_name:   name.trim(),
          customer_phone:  phone.trim(),
          table_id:        tableId,
          scheduled_start: scheduledStart,
          scheduled_end:   scheduledEnd,
          rate_per_hour:   effectiveRate,
          num_people:      numPeople ? Number(numPeople) : undefined,
          advance_paid:    wantAdvance ? { amount: advanceNum, method: advanceMethod } : undefined,
        }),
      });
      const body = await res.json() as { success: true; data: unknown } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    onSuccess: () => {
      toast.success("Manual booking created");
      // Refresh bookings on every surface that lists them.
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
              <Label className="text-xs">Customer name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z\s]/g, ""))}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone (10 digits)</Label>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="9XXXXXXXXX"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Table</Label>
            <select
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {tables.length === 0 && <option value="">Loading…</option>}
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · ₹{t.hourly_rate}/hr
                </option>
              ))}
            </select>
          </div>

          {peopleOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">
                {chosenTable?.type === "ps5" ? "Controllers" : "Players"}
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

                  const rate   = chosenTable!.people_pricing?.[n] ?? 0;
                  return (
                    <button
                      key={n}
                      onClick={() => setNumPeople(n)}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                        active
                          ? "bg-[#D4541A] text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
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

          <div className="space-y-1.5">
            <Label className="text-xs">Duration</Label>
            <div className="flex flex-wrap gap-1.5">
              {DURATION_PRESETS.map((p) => (
                <button
                  key={p.mins}
                  onClick={() => setDuration(p.mins)}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                    duration === p.mins
                      ? "bg-[#D4541A] text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
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
                onClick={() => setAdvanceMethod((m) => m === "cash" ? null : "cash")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1 ${
                  advanceMethod === "cash" ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300" : "bg-gray-100 text-gray-700"
                }`}
              >
                <Banknote className="h-3 w-3" /> Cash
              </button>
              <button
                onClick={() => setAdvanceMethod((m) => m === "upi" ? null : "upi")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1 ${
                  advanceMethod === "upi" ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300" : "bg-gray-100 text-gray-700"
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

        <div className="px-5 py-3 border-t flex justify-end gap-2 bg-gray-50">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-md text-sm font-semibold bg-white border hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={() => { setError(null); create.mutate(); }}
            disabled={create.isPending}
            className="px-4 py-2 rounded-md text-sm font-bold text-white bg-[#D4541A] hover:opacity-90 disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create booking"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
