"use client";

import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePOSStore, getSelectedOrder } from "@/store/pos";
import { calculateBill, GRACE_MINS } from "@/lib/billing/engine";
import { formatCurrency, formatCountdown, formatElapsed } from "@/lib/utils";
import { X, Plus, Trash2, Square, Timer } from "lucide-react";
import { toast } from "sonner";
import type { OrderItem, OrderExtra } from "@/lib/supabase/types";

interface OrderPanelProps {
  locationId: string;
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export function OrderPanel({ locationId }: OrderPanelProps) {
  const selectedOrderId = usePOSStore((s) => s.selectedOrderId);
  if (!selectedOrderId) return null;
  return <OrderPanelInner locationId={locationId} />;
}

function OrderPanelInner({ locationId }: OrderPanelProps) {
  const store         = usePOSStore();
  const selectedOrder = getSelectedOrder(store);
  const now           = store.now;
  const qc            = useQueryClient();

  const [addExtraOpen, setAddExtraOpen] = useState(false);
  const [extraForm,    setExtraForm]    = useState({ name: "", price: "", quantity: "1" });
  // tempId → real DB id, kept around so a fast delete-after-add doesn't 404.
  // Declared before the early return so React's hook order stays stable.
  const pendingExtras = useRef<Map<string, Promise<string>>>(new Map());

  if (!selectedOrder) return null;

  const activeItems  = selectedOrder.items.filter((i) => i.status !== "cancelled" && i.status !== "scheduled" && !i.is_deleted);
  const activeExtras = selectedOrder.extras.filter((e) => !e.is_deleted);
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
  const bill         = calculateBill(activeItems, activeExtras, now, null, selectedOrder.advance_paid ?? 0, selectedOrder.discount_amount ?? 0);
  const fullyPrePaid = bill.advancePaid > 0 && bill.advancePaid >= Math.max(0, bill.scheduledSubtotal - bill.discountAmount);
  const hasRunning   = activeItems.some((i) => i.status === "running");

  async function stopSession(item: OrderItem) {
    const nowISO = new Date().toISOString();
    store.patchOrderItem(item.id, { status: "finished", actual_end: nowISO });
    const res = await fetch("/api/sessions/stop", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ order_item_id: item.id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      store.patchOrderItem(item.id, { status: "running", actual_end: null });
      toast.error(body.error ?? `Failed to stop session (${res.status})`);
    } else {
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    }
  }

  async function resolveRealExtraId(id: string): Promise<string | null> {
    const pending = pendingExtras.current.get(id);
    if (!pending) return id;
    try { return await pending; } catch { return null; }
  }

  async function addExtra() {
    if (!extraForm.name || !extraForm.price || !selectedOrder) return;
    const orderId = selectedOrder.id;
    const tempId  = crypto.randomUUID();
    const optimistic: OrderExtra = {
      id:                tempId,
      order_id:          orderId,
      name:              extraForm.name,
      price:             parseFloat(extraForm.price),
      cost_price:        0,
      quantity:          parseInt(extraForm.quantity),
      inventory_item_id: null,
      is_deleted:        false,
      deleted_at:        null,
      added_by:          null,
      created_at:        new Date().toISOString(),
    };
    store.addOrderExtra(orderId, optimistic);
    setExtraForm({ name: "", price: "", quantity: "1" });
    setAddExtraOpen(false);

    const addPromise: Promise<string> = (async () => {
      const res = await fetch(`/api/orders/${orderId}/extras`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: optimistic.name, price: optimistic.price, quantity: optimistic.quantity }),
      });
      if (!res.ok) {
        store.removeOrderExtra(orderId, tempId);
        toast.error("Failed to add extra");
        throw new Error("add failed");
      }
      const body = await res.json() as
        | { success: true;  data: { id: string } }
        | { success: false; error: string };
      if (!body.success) {
        store.removeOrderExtra(orderId, tempId);
        toast.error(body.error || "Failed to add extra");
        throw new Error(body.error);
      }
      store.replaceOrderExtraId(orderId, tempId, body.data.id);
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      return body.data.id;
    })();
    pendingExtras.current.set(tempId, addPromise);
    addPromise.finally(() => { pendingExtras.current.delete(tempId); });
  }

  async function deleteExtra(extraId: string) {
    if (!selectedOrder) return;
    const orderId = selectedOrder.id;
    store.removeOrderExtra(orderId, extraId);
    const realId = await resolveRealExtraId(extraId);
    if (!realId) return; // add failed, nothing to delete server-side
    const res = await fetch(`/api/orders/${orderId}/extras/${realId}`, { method: "DELETE" });
    if (!res.ok) {
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    } else {
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      qc.invalidateQueries({ queryKey: ["inventory", locationId] });
      qc.invalidateQueries({ queryKey: ["inventory-low-list"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-count"] });
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/40 dark:bg-black/60"
        onClick={() => store.selectOrder(null)}
      />

      {/* Panel */}
      <div className="w-[420px] flex flex-col bg-white dark:bg-[#111] border-l border-gray-200 dark:border-[#1f1f1f] shadow-2xl">

        {/* ── Panel header ── */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-[#1f1f1f]">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
              style={{ background: "#D4541A" }}
            >
              {initials(selectedOrder.customer_name)}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-gray-900 dark:text-white text-sm leading-tight truncate">
                {selectedOrder.customer_name}
              </p>
              {selectedOrder.customer_phone && (
                <p className="text-xs mt-0.5 truncate text-gray-500 dark:text-[#666]">
                  {selectedOrder.customer_phone}
                </p>
              )}
            </div>
            <span
              className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ml-1"
              style={
                selectedOrder.type === "walk_in"
                  ? { background: "rgba(212,84,26,0.1)", color: "#D4541A" }
                  : { background: "rgba(139,92,246,0.1)", color: "#a78bfa" }
              }
            >
              {selectedOrder.type === "walk_in" ? "Walk-in" : "Online"}
            </span>
          </div>
          <button
            onClick={() => store.selectOrder(null)}
            className="shrink-0 ml-3 p-1.5 rounded-lg text-gray-400 dark:text-[#555] hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-w-0">

          {/* Session cards */}
          {activeItems.map((item) => {
            const isRunning  = item.status === "running";
            const lineBill   = calculateBill([item], [], now).subtotal;
            const tableInfo  = item.table as { name?: string; type?: string } | null;
            const tableName  = tableInfo?.name ?? "Table";

            const tableInStore   = store.tables.find((t) => t.id === item.table_id);
            const hasNextBooking = !!tableInStore?.upcomingBooking;

            let countdown  = "";
            let elapsed    = "";
            let isOvertime = false;
            let isGrace    = false;
            if (isRunning) {
              if (item.actual_start) elapsed = formatElapsed(new Date(item.actual_start), now);
              if (item.expected_end) {
                const exp  = new Date(item.expected_end);
                const otMs = Math.max(0, now.getTime() - exp.getTime());
                isGrace    = otMs > 0 && otMs <= GRACE_MINS * 60 * 1000 && !hasNextBooking;
                isOvertime = otMs > 0 && !isGrace;
                countdown  = isGrace
                  ? formatCountdown(new Date(exp.getTime() + GRACE_MINS * 60 * 1000), now)
                  : formatCountdown(exp, now);
              }
            }
            const showHandover = isOvertime && hasNextBooking;

            const progressPct = (isRunning && item.actual_start && item.expected_end && !isOvertime)
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
                    ? showHandover
                      ? "border-2 border-orange-300 dark:border-[rgba(249,115,22,0.35)]"
                      : isOvertime
                      ? "border-2 border-red-300 dark:border-[rgba(239,68,68,0.35)]"
                      : isGrace
                      ? "border-2 border-amber-300 dark:border-[rgba(245,158,11,0.35)]"
                      : "border-2 border-emerald-300 dark:border-[rgba(16,185,129,0.35)]"
                    : "border border-gray-100 dark:border-[#1f1f1f]"
                }`}
              >
                {/* Top row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <p className="font-bold text-gray-900 dark:text-white text-sm">{tableName}</p>
                    {isRunning && (
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                        style={
                          showHandover
                            ? { background: "rgba(249,115,22,0.1)", color: "#f97316" }
                            : isOvertime
                            ? { background: "rgba(239,68,68,0.1)",  color: "#ef4444" }
                            : isGrace
                            ? { background: "rgba(245,158,11,0.1)", color: "#f59e0b" }
                            : { background: "rgba(16,185,129,0.1)", color: "#10b981" }
                        }
                      >
                        {showHandover ? "Handover" : isOvertime ? "Overtime" : isGrace ? "Grace" : "Live"}
                      </span>
                    )}
                    {item.status === "scheduled" && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                        style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>
                        Scheduled
                      </span>
                    )}
                    {item.status === "finished" && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide bg-gray-100 dark:bg-[#1A1A1A] text-gray-400 dark:text-[#555]">
                        Finished
                      </span>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-base tabular-nums" style={{ color: isRunning ? "#D4541A" : undefined }}>
                      {formatCurrency(lineBill)}
                    </p>
                    <p className="text-[10px] mt-0.5 text-gray-400 dark:text-[#444]">₹{item.rate_per_hour}/hr</p>
                  </div>
                </div>

                {/* Elapsed + countdown */}
                {isRunning && (
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#0a0a0a] border border-gray-100 dark:border-[#1a1a1a]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wide">Elapsed</span>
                      <span className="text-xs font-mono font-semibold tabular-nums text-gray-700 dark:text-[#aaa]">{elapsed || "—"}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {showHandover ? (
                        <span className="text-xs font-mono font-semibold" style={{ color: "#f97316" }}>
                          Handover — {tableInStore?.upcomingBooking?.order?.customer_name ?? "next"} waiting
                        </span>
                      ) : isOvertime ? (
                        <span className="text-xs font-mono font-semibold tabular-nums" style={{ color: "#ef4444" }}>
                          +{countdown} OT
                        </span>
                      ) : isGrace ? (
                        <span className="text-xs font-mono font-semibold tabular-nums" style={{ color: "#f59e0b" }}>
                          {countdown} grace left
                        </span>
                      ) : (
                        <>
                          <span className="text-[10px] text-gray-400 uppercase tracking-wide">Left</span>
                          <span className="text-xs font-mono font-semibold tabular-nums" style={{ color: "#D4541A" }}>{countdown}</span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Progress bar */}
                {isRunning && !isOvertime && (progressPct > 0 || isGrace) && (
                  <div className="h-1.5 rounded-full overflow-hidden bg-gray-100 dark:bg-[#1A1A1A]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: isGrace ? "100%" : `${progressPct}%`,
                        background: isGrace ? "#f59e0b" : progressPct > 85 ? "#ef4444" : "#D4541A",
                        transition: "width 1s linear",
                      }}
                    />
                  </div>
                )}

                {/* Actions */}
                {isRunning && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => stopSession(item)}
                      className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-white text-xs font-bold transition-colors hover:bg-red-500"
                      style={{ background: "#ef4444" }}
                    >
                      <Square className="h-3 w-3 fill-current" /> Stop
                    </button>
                    {!hasNextBooking && (
                      <button
                        onClick={() => store.setExtendModalItem(item)}
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
                      store.patchOrderItem(item.id, { status: "running", actual_start: startTime });
                      const res = await fetch("/api/sessions/start", {
                        method:  "POST",
                        headers: { "Content-Type": "application/json" },
                        body:    JSON.stringify({ order_item_id: item.id }),
                      });
                      if (!res.ok) {
                        const body = await res.json() as { error?: string };
                        store.patchOrderItem(item.id, { status: "scheduled", actual_start: null });
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

          {/* Extras */}
          <div className="rounded-2xl overflow-hidden bg-white dark:bg-[#0d0d0d] border border-gray-100 dark:border-[#1f1f1f] shadow-sm">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-[#1f1f1f]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-[#444]">Extras</p>
              {!addExtraOpen && (
                <button
                  onClick={() => setAddExtraOpen(true)}
                  className="flex items-center gap-1 text-xs font-semibold transition-colors hover:brightness-75"
                  style={{ color: "#D4541A" }}
                >
                  <Plus className="h-3 w-3" /> Add
                </button>
              )}
            </div>
            <div className="p-3 space-y-1">
              {groupedExtras.length === 0 && !addExtraOpen && (
                <p className="text-xs py-1.5 text-gray-400 dark:text-[#444]">None added</p>
              )}
              {groupedExtras.map((extra) => (
                <div key={extra.id} className="flex items-center justify-between py-1 px-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-gray-900 dark:text-white truncate">{extra.name}</span>
                    <span className="text-xs shrink-0 text-gray-400 dark:text-[#555]">×{extra.quantity}</span>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {formatCurrency(extra.price * extra.quantity)}
                    </span>
                    <button onClick={() => deleteExtra(extra.ids[extra.ids.length - 1])} className="text-gray-400 hover:text-red-400 transition-colors">
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
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors
                      bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]
                      text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#444]
                      focus:border-[#D4541A]"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <input
                      type="number" placeholder="Price (₹)" value={extraForm.price}
                      onChange={(e) => setExtraForm({ ...extraForm, price: e.target.value })}
                      className="flex-1 px-3 py-2 rounded-lg text-sm outline-none transition-colors
                        bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
                        text-gray-900 dark:text-white placeholder-gray-400 focus:border-[#D4541A]"
                    />
                    <input
                      type="number" placeholder="Qty" value={extraForm.quantity}
                      onChange={(e) => setExtraForm({ ...extraForm, quantity: e.target.value })}
                      className="w-16 px-3 py-2 rounded-lg text-sm outline-none transition-colors
                        bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
                        text-gray-900 dark:text-white placeholder-gray-400 focus:border-[#D4541A]"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={addExtra}
                      className="flex-1 py-2 rounded-lg text-white text-xs font-bold transition-opacity hover:opacity-85"
                      style={{ background: "#D4541A" }}
                    >
                      Add Extra
                    </button>
                    <button
                      onClick={() => setAddExtraOpen(false)}
                      className="px-4 py-2 rounded-lg text-xs font-medium transition-colors
                        bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
                        text-gray-500 dark:text-[#666] hover:text-gray-900 dark:hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="h-2" />
        </div>

        {/* ── Pinned bill footer ── */}
        <div className="shrink-0 bg-white dark:bg-[#111] border-t border-gray-200 dark:border-[#1f1f1f]">
          <div className="px-5 pt-3 pb-1 overflow-y-auto max-h-44 space-y-1">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-gray-400 dark:text-[#555] mb-2">Receipt</p>
            {fullyPrePaid ? (
              <>
                <div className="flex items-center justify-between py-0.5">
                  <span className="text-xs font-bold" style={{ color: "#10b981" }}>Session covered</span>
                  <span className="text-xs font-bold" style={{ color: "#10b981" }}>✓</span>
                </div>
                {bill.tableLines.filter((l) => l.overtimeMins > 0).map((line) => {
                  const ti = activeItems.find((i) => i.id === line.id);
                  const tn = (ti?.table as { name?: string } | null)?.name ?? "Table";
                  return (
                    <div key={line.id} className="flex justify-between items-baseline gap-2 py-0.5">
                      <span className="truncate text-xs text-gray-600 dark:text-[#aaa]">{tn} OT {line.overtimeMins}m</span>
                      <span className="shrink-0 font-semibold text-gray-900 dark:text-white tabular-nums text-xs">{formatCurrency(line.overtimeAmount)}</span>
                    </div>
                  );
                })}
              </>
            ) : (
              bill.tableLines.map((line) => {
                const ti = activeItems.find((i) => i.id === line.id);
                const tn = (ti?.table as { name?: string } | null)?.name ?? "Table";
                return (
                  <div key={line.id} className="flex justify-between items-baseline gap-2 py-0.5">
                    <span className="truncate text-xs text-gray-600 dark:text-[#aaa]">{tn} · {line.durationMins}m</span>
                    <span className="shrink-0 font-semibold text-gray-900 dark:text-white tabular-nums text-xs">{formatCurrency(line.amount)}</span>
                  </div>
                );
              })
            )}
            {bill.extraLines.length > 0 && (
              <div className="pt-1.5 mt-1 border-t border-dashed border-gray-200 dark:border-[#2a2a2a] space-y-1">
                {bill.extraLines.map((line) => (
                  <div key={line.id} className="flex justify-between items-baseline gap-2 py-0.5">
                    <span className="truncate text-xs text-gray-600 dark:text-[#aaa]">{line.name} ×{line.quantity}</span>
                    <span className="shrink-0 font-semibold text-gray-900 dark:text-white tabular-nums text-xs">{formatCurrency(line.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {!fullyPrePaid && (bill.tableLines.length + bill.extraLines.length) > 1 && (
              <div className="flex justify-between items-baseline gap-2 pt-1.5 mt-1 border-t border-dashed border-gray-200 dark:border-[#2a2a2a]">
                <span className="text-xs font-semibold text-gray-500 dark:text-[#888]">Subtotal</span>
                <span className="font-semibold text-gray-900 dark:text-white tabular-nums text-xs">{formatCurrency(bill.subtotal)}</span>
              </div>
            )}
            {bill.discountAmount > 0 && (
              <div className="flex justify-between items-baseline gap-2 py-0.5">
                <span className="text-xs font-semibold" style={{ color: "#10b981" }}>Discount</span>
                <span className="text-xs font-semibold tabular-nums" style={{ color: "#10b981" }}>−{formatCurrency(bill.discountAmount)}</span>
              </div>
            )}
            {!fullyPrePaid && bill.advancePaid > 0 && (
              <div className="flex justify-between items-baseline gap-2 py-0.5">
                <span className="text-xs font-semibold" style={{ color: "#10b981" }}>Advance paid</span>
                <span className="text-xs font-semibold tabular-nums" style={{ color: "#10b981" }}>−{formatCurrency(bill.advancePaid)}</span>
              </div>
            )}
          </div>
          <div className="px-5 pb-5 pt-3 border-t border-gray-100 dark:border-[#1a1a1a]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-[#555]">Total due</span>
              <span className="text-2xl font-bold tabular-nums leading-none" style={{ color: "#D4541A" }}>
                {formatCurrency(bill.totalDue)}
              </span>
            </div>
            <button
              onClick={() => store.setFinalizeOrderId(selectedOrder.id)}
              disabled={hasRunning}
              className={`w-full py-3 rounded-xl text-sm font-bold transition-opacity ${
                hasRunning
                  ? "bg-gray-100 dark:bg-[#1a1a1a] text-gray-300 dark:text-[#333] cursor-not-allowed"
                  : "text-white hover:brightness-110 active:brightness-95 cursor-pointer"
              }`}
              style={hasRunning ? {} : { background: "#D4541A" }}
            >
              {hasRunning ? "Stop sessions first" : "Finalize & Collect"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
