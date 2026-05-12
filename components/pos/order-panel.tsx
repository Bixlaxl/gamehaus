"use client";

import { useState } from "react";
import { usePOSStore, getSelectedOrder } from "@/store/pos";
import { calculateBill } from "@/lib/billing/engine";
import { formatCurrency, formatCountdown, cn } from "@/lib/utils";
import { Plus, Trash2, Square, Timer, CheckCircle2 } from "lucide-react";
import type { OrderItem } from "@/lib/supabase/types";

interface OrderPanelProps {
  locationId: string;
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export function OrderPanel({ locationId: _locationId }: OrderPanelProps) {
  const store        = usePOSStore();
  const selectedOrder = getSelectedOrder(store);
  const now          = store.now;

  const [addExtraOpen,  setAddExtraOpen]  = useState(false);
  const [extraForm,     setExtraForm]     = useState({ name: "", price: "", quantity: "1" });
  const [extraLoading,  setExtraLoading]  = useState(false);

  if (!selectedOrder) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
        <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center">
          <Square className="h-6 w-6 text-slate-600" />
        </div>
        <div>
          <p className="text-slate-300 font-medium">No order selected</p>
          <p className="text-slate-600 text-sm mt-0.5">Select a table or start a new walk-in</p>
        </div>
      </div>
    );
  }

  const activeItems  = selectedOrder.items.filter((i) => i.status !== "cancelled" && !i.is_deleted);
  const activeExtras = selectedOrder.extras.filter((e) => !e.is_deleted);
  const bill         = calculateBill(activeItems, activeExtras, now);
  const hasRunning   = activeItems.some((i) => i.status === "running");

  async function stopSession(item: OrderItem) {
    const res = await fetch("/api/sessions/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_item_id: item.id }),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      alert(body.error ?? "Failed to stop session");
    }
  }

  async function addExtra() {
    if (!extraForm.name || !extraForm.price) return;
    setExtraLoading(true);
    const res = await fetch(`/api/orders/${selectedOrder!.id}/extras`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:     extraForm.name,
        price:    parseFloat(extraForm.price),
        quantity: parseInt(extraForm.quantity),
      }),
    });
    if (res.ok) {
      setExtraForm({ name: "", price: "", quantity: "1" });
      setAddExtraOpen(false);
    }
    setExtraLoading(false);
  }

  async function deleteExtra(extraId: string) {
    await fetch(`/api/orders/${selectedOrder!.id}/extras/${extraId}`, { method: "DELETE" });
  }

  return (
    <div className="h-full flex flex-col">

      {/* ── Customer header ─────────────────────────── */}
      <div className="shrink-0 px-6 py-4 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
              {initials(selectedOrder.customer_name)}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-slate-100 leading-tight">{selectedOrder.customer_name}</p>
              {selectedOrder.customer_phone && (
                <p className="text-xs text-slate-400 mt-0.5">{selectedOrder.customer_phone}</p>
              )}
            </div>
          </div>
          <span className={cn(
            "shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-wide",
            selectedOrder.type === "walk_in"
              ? "bg-blue-500/15 text-blue-400"
              : "bg-violet-500/15 text-violet-400"
          )}>
            {selectedOrder.type === "walk_in" ? "Walk-in" : "Online"}
          </span>
        </div>
      </div>

      {/* ── Sessions + extras ───────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

        {/* Table sessions */}
        {activeItems.map((item) => {
          const isRunning  = item.status === "running";
          const lineBill   = calculateBill([item], [], now);
          const liveAmount = lineBill.subtotal;
          const tableInfo  = item.table ?? { name: "Table", type: "snooker" };

          let countdown  = "";
          let isOvertime = false;
          if (isRunning && item.expected_end) {
            const expectedEnd = new Date(item.expected_end);
            countdown  = formatCountdown(expectedEnd, now);
            isOvertime = expectedEnd.getTime() < now.getTime();
          }

          return (
            <div
              key={item.id}
              className={cn(
                "rounded-xl border bg-slate-800 p-4",
                isRunning && !isOvertime && "border-emerald-500/40",
                isRunning && isOvertime  && "border-red-500/40",
                !isRunning               && "border-slate-700"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-100 text-sm">
                      {(tableInfo as { name: string }).name}
                    </p>
                    {isRunning && (
                      <span className={cn(
                        "flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide",
                        isOvertime ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"
                      )}>
                        <span className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          isOvertime ? "bg-red-400 animate-pulse" : "bg-emerald-400 animate-pulse"
                        )} />
                        {isOvertime ? "Overtime" : "Running"}
                      </span>
                    )}
                    {item.status === "scheduled" && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide bg-amber-500/15 text-amber-400">
                        Scheduled
                      </span>
                    )}
                    {item.status === "finished" && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide bg-slate-700 text-slate-400">
                        Finished
                      </span>
                    )}
                  </div>

                  {isRunning && (
                    <p className={cn(
                      "text-xs font-mono font-semibold mt-1 tabular-nums",
                      isOvertime ? "text-red-400" : "text-emerald-400"
                    )}>
                      {isOvertime ? "OVERTIME" : countdown + " remaining"}
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-100">{formatCurrency(liveAmount)}</p>
                  <p className="text-xs text-slate-500 mt-0.5">₹{item.rate_per_hour}/hr</p>
                </div>
              </div>

              {isRunning && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => stopSession(item)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" /> Stop
                  </button>
                  <button
                    onClick={() => store.setExtendModalItem(item)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-semibold transition-colors"
                  >
                    <Timer className="h-3.5 w-3.5" /> Extend
                  </button>
                </div>
              )}

              {item.status === "scheduled" && (
                <button
                  className="mt-3 w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  onClick={async () => {
                    await fetch("/api/sessions/start", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ order_item_id: item.id }),
                    });
                  }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Start Session
                </button>
              )}
            </div>
          );
        })}

        {/* ── Extras ──────────────────────────────── */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50">
          <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Extras</p>
            {!addExtraOpen && (
              <button
                onClick={() => setAddExtraOpen(true)}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-semibold transition-colors"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
            )}
          </div>

          <div className="p-3 space-y-1">
            {activeExtras.length === 0 && !addExtraOpen && (
              <p className="text-xs text-slate-600 text-center py-2">No extras added</p>
            )}

            {activeExtras.map((extra) => (
              <div key={extra.id} className="flex items-center justify-between py-1.5 px-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-slate-200 truncate">{extra.name}</span>
                  <span className="text-xs text-slate-500 shrink-0">×{extra.quantity}</span>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="text-sm font-medium text-slate-200">
                    {formatCurrency(extra.price * extra.quantity)}
                  </span>
                  <button
                    onClick={() => deleteExtra(extra.id)}
                    className="text-slate-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {addExtraOpen && (
              <div className="pt-2 space-y-2">
                <input
                  placeholder="Item name (e.g. Coke)"
                  value={extraForm.name}
                  onChange={(e) => setExtraForm({ ...extraForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-blue-500 transition-colors"
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Price (₹)"
                    value={extraForm.price}
                    onChange={(e) => setExtraForm({ ...extraForm, price: e.target.value })}
                    className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-blue-500 transition-colors"
                  />
                  <input
                    type="number"
                    placeholder="Qty"
                    value={extraForm.quantity}
                    onChange={(e) => setExtraForm({ ...extraForm, quantity: e.target.value })}
                    className="w-20 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={addExtra}
                    disabled={extraLoading}
                    className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                  >
                    {extraLoading ? "Adding..." : "Add Extra"}
                  </button>
                  <button
                    onClick={() => setAddExtraOpen(false)}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bill footer ─────────────────────────────── */}
      <div className="shrink-0 px-5 py-4 bg-slate-900 border-t border-slate-800 space-y-2">
        {bill.discountAmount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Discount</span>
            <span className="text-emerald-400 font-medium">−{formatCurrency(bill.discountAmount)}</span>
          </div>
        )}
        {bill.advancePaid > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Advance paid</span>
            <span className="text-emerald-400 font-medium">−{formatCurrency(bill.advancePaid)}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-sm text-slate-400">Total due</span>
          <span className="text-2xl font-bold text-slate-100 tabular-nums">
            {formatCurrency(bill.totalDue)}
          </span>
        </div>

        <button
          onClick={() => store.setFinalizeOrderId(selectedOrder.id)}
          disabled={hasRunning}
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors"
        >
          {hasRunning ? "Stop all sessions to finalize" : "Finalize & Collect Payment"}
        </button>
      </div>
    </div>
  );
}
