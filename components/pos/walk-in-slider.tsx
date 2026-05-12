"use client";

import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Star } from "lucide-react";
import type { Table } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, cn } from "@/lib/utils";

interface CustomerLookup {
  name: string | null;
  points_balance: number;
  visit_count: number;
}

interface WalkInSliderProps {
  locationId: string;
}

const supabase = createClient();

const DURATION_PRESETS = [
  { label: "30m", mins: 30 },
  { label: "1h",  mins: 60 },
  { label: "1.5h",mins: 90 },
  { label: "2h",  mins: 120 },
];

export function WalkInSlider({ locationId }: WalkInSliderProps) {
  const {
    walkInOpen,
    walkInPrefilledTableId,
    setWalkInOpen,
    tables,
    selectOrder,
  } = usePOSStore();
  const qc = useQueryClient();

  const [customerName,     setCustomerName]     = useState("");
  const [customerPhone,    setCustomerPhone]     = useState("");
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [durations,        setDurations]        = useState<Record<string, number>>({});
  const [loading,          setLoading]          = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [customer,         setCustomer]         = useState<CustomerLookup | null>(null);
  const [lookingUp,        setLookingUp]        = useState(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const idleTables = tables.filter((t) => !t.activeOrderItem);

  // Pre-fill table when slider opens from a table click
  useEffect(() => {
    if (walkInOpen && walkInPrefilledTableId) {
      setSelectedTableIds([walkInPrefilledTableId]);
      setDurations({ [walkInPrefilledTableId]: 60 });
    }
  }, [walkInOpen, walkInPrefilledTableId]);

  // Debounced phone lookup
  function handlePhoneChange(val: string) {
    setCustomerPhone(val);
    setCustomer(null);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (val.trim().length >= 6) {
      setLookingUp(true);
      lookupTimer.current = setTimeout(async () => {
        const res = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(val.trim())}`);
        const data = await res.json() as { found: boolean; customer: CustomerLookup | null };
        setCustomer(data.customer);
        if (data.found && data.customer?.name && !customerName.trim()) {
          setCustomerName(data.customer.name);
        }
        setLookingUp(false);
      }, 600);
    } else {
      setLookingUp(false);
    }
  }

  function reset() {
    setCustomerName("");
    setCustomerPhone("");
    setSelectedTableIds([]);
    setDurations({});
    setError(null);
    setCustomer(null);
    setLookingUp(false);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
  }

  function close() {
    reset();
    setWalkInOpen(false);
    usePOSStore.setState({ walkInPrefilledTableId: null });
  }

  function toggleTable(id: string) {
    setSelectedTableIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
    setDurations((prev) => ({ ...prev, [id]: prev[id] ?? 60 }));
  }

  function setDuration(tableId: string, mins: number) {
    setDurations((prev) => ({ ...prev, [tableId]: mins }));
  }

  async function createOrder() {
    if (!customerName.trim()) { setError("Customer name is required"); return; }
    if (selectedTableIds.length === 0) { setError("Select at least one table"); return; }

    setLoading(true);
    setError(null);

    const items = selectedTableIds.map((tid) => {
      const table = tables.find((t) => t.id === tid) as Table;
      return {
        table_id: tid,
        scheduled_duration_mins: durations[tid] ?? 60,
        rate_per_hour: table.hourly_rate,
      };
    });

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location_id: locationId,
        type: "walk_in",
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim() || undefined,
        items,
      }),
    });

    const body = await res.json() as
      | { success: true; data: { order_id: string } }
      | { success: false; error: string };

    if (!body.success) {
      setError(body.error);
      setLoading(false);
      return;
    }

    // Start all sessions immediately
    for (const item of items) {
      const { data: orderItem } = await supabase
        .from("order_items")
        .select("id")
        .eq("order_id", body.data.order_id)
        .eq("table_id", item.table_id)
        .single();

      if (orderItem) {
        await fetch("/api/sessions/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_item_id: orderItem.id }),
        });
      }
    }

    qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    qc.invalidateQueries({ queryKey: ["pos-tables", locationId] });
    selectOrder(body.data.order_id);
    close();
    setLoading(false);
  }

  if (!walkInOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/50" onClick={close} />
      <div className="w-96 bg-gray-800 border-l border-gray-700 flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">New Walk-in</h2>
          <button onClick={close} className="text-gray-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Customer */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Customer</h3>
            <div className="space-y-2">
              <Label className="text-gray-400">Name *</Label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer name"
                className="bg-gray-700 border-gray-600 text-white"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-400">Phone</Label>
              <Input
                value={customerPhone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="Phone number"
                type="tel"
                className="bg-gray-700 border-gray-600 text-white"
              />
              {lookingUp && (
                <p className="text-xs text-gray-500">Looking up...</p>
              )}
              {!lookingUp && customer && (
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <Star className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs text-amber-300 font-medium">
                    {customer.points_balance} pts · {customer.visit_count} visit{customer.visit_count !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
              {!lookingUp && customerPhone.trim().length >= 6 && !customer && (
                <p className="text-xs text-gray-500">New customer — profile will be created</p>
              )}
            </div>
          </div>

          {/* Tables */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tables</h3>
            {idleTables.length === 0 && (
              <p className="text-sm text-gray-500">No idle tables available</p>
            )}
            {idleTables.map((table) => {
              const selected = selectedTableIds.includes(table.id);
              const dur      = durations[table.id] ?? 60;

              return (
                <div key={table.id} className="space-y-2">
                  <button
                    onClick={() => toggleTable(table.id)}
                    className={cn(
                      "w-full text-left rounded-lg p-3 border transition-all",
                      selected
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-gray-600 hover:border-gray-400"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">{table.name}</span>
                      <span className="text-sm text-gray-400">
                        {formatCurrency(table.hourly_rate)}/hr
                      </span>
                    </div>
                  </button>

                  {selected && (
                    <div className="px-1 space-y-1.5">
                      <p className="text-xs text-gray-400">Duration</p>
                      <div className="flex gap-1.5">
                        {DURATION_PRESETS.map((p) => (
                          <button
                            key={p.mins}
                            onClick={() => setDuration(table.id, p.mins)}
                            className={cn(
                              "flex-1 py-1.5 rounded text-xs font-semibold border transition-colors",
                              dur === p.mins
                                ? "bg-blue-600 border-blue-600 text-white"
                                : "border-gray-600 text-gray-300 hover:border-gray-400"
                            )}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="15"
                          step="15"
                          value={dur}
                          onChange={(e) => setDuration(table.id, parseInt(e.target.value) || 60)}
                          className="w-20 bg-gray-700 border border-gray-600 text-white text-sm rounded px-2 py-1"
                        />
                        <span className="text-xs text-gray-400">mins custom</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-700">
          <Button
            className="w-full bg-blue-600 hover:bg-blue-700 font-semibold"
            onClick={createOrder}
            disabled={loading}
            size="lg"
          >
            {loading ? "Starting..." : "Start Walk-in"}
          </Button>
        </div>
      </div>
    </div>
  );
}
