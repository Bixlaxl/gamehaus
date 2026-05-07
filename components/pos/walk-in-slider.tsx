"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import type { Table } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";

interface WalkInSliderProps {
  locationId: string;
}

const supabase = createClient();

export function WalkInSlider({ locationId }: WalkInSliderProps) {
  const { walkInOpen, setWalkInOpen, tables, selectOrder, setOpenOrders, openOrders } =
    usePOSStore();
  const qc = useQueryClient();

  const [step, setStep] = useState<"customer" | "tables">("customer");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [durations, setDurations] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idleTables = tables.filter((t) => !t.activeOrderItem);

  function reset() {
    setStep("customer");
    setCustomerName("");
    setCustomerPhone("");
    setSelectedTableIds([]);
    setDurations({});
    setError(null);
  }

  function close() {
    reset();
    setWalkInOpen(false);
  }

  function toggleTable(id: string) {
    setSelectedTableIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  async function createOrder() {
    if (!customerName.trim()) {
      setError("Customer name is required");
      return;
    }
    if (selectedTableIds.length === 0) {
      setError("Select at least one table");
      return;
    }

    setLoading(true);
    setError(null);

    const items = selectedTableIds.map((tid) => {
      const table = tables.find((t) => t.id === tid) as Table;
      const durationMins = parseInt(durations[tid] ?? "60");
      return {
        table_id: tid,
        scheduled_duration_mins: durationMins,
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
      // Get the order item id
      const { data: orderItems } = await supabase
        .from("order_items")
        .select("id")
        .eq("order_id", body.data.order_id)
        .eq("table_id", item.table_id)
        .single();

      if (orderItems) {
        await fetch("/api/sessions/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_item_id: orderItems.id }),
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
      <div
        className="flex-1 bg-black/50"
        onClick={close}
      />
      <div className="w-96 bg-gray-800 border-l border-gray-700 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">New Walk-in</h2>
          <button onClick={close} className="text-gray-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Customer details */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-300">Customer</h3>
            <div className="space-y-2">
              <Label className="text-gray-400">Name *</Label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer name"
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-400">Phone</Label>
              <Input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Phone number"
                type="tel"
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>
          </div>

          {/* Table selection */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-300">Tables</h3>
            {idleTables.length === 0 && (
              <p className="text-sm text-gray-500">No idle tables available</p>
            )}
            {idleTables.map((table) => {
              const selected = selectedTableIds.includes(table.id);
              return (
                <div key={table.id}>
                  <button
                    onClick={() => toggleTable(table.id)}
                    className={`w-full text-left rounded-lg p-3 border transition-all ${
                      selected
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-gray-600 hover:border-gray-400"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">
                        {table.name}
                      </span>
                      <span className="text-sm text-gray-400">
                        {formatCurrency(table.hourly_rate)}/hr
                      </span>
                    </div>
                  </button>
                  {selected && (
                    <div className="mt-1 px-1">
                      <Label className="text-xs text-gray-400">
                        Duration (mins)
                      </Label>
                      <Input
                        type="number"
                        min="15"
                        step="15"
                        value={durations[table.id] ?? "60"}
                        onChange={(e) =>
                          setDurations({
                            ...durations,
                            [table.id]: e.target.value,
                          })
                        }
                        className="mt-1 bg-gray-700 border-gray-600 text-white h-8"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-700">
          <Button
            className="w-full bg-blue-600 hover:bg-blue-700 font-semibold"
            onClick={createOrder}
            disabled={loading}
            size="lg"
          >
            {loading ? "Creating..." : "Start Walk-in"}
          </Button>
        </div>
      </div>
    </div>
  );
}
