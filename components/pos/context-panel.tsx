"use client";

import { useState, useEffect, useRef, memo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { calculateBill } from "@/lib/billing/engine";

const AUTO_STOP_GRACE_MINS = 2;
import { formatCurrency, formatCountdown, formatElapsed } from "@/lib/utils";
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
    <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-gray-200 dark:border-[#1f1f1f]">
      <div className="min-w-0">
        <p className="font-bold text-gray-900 dark:text-white text-sm truncate">{title}</p>
        {subtitle && (
          <p className="text-xs mt-0.5 text-gray-400 dark:text-[#555] truncate">{subtitle}</p>
        )}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="shrink-0 ml-3 p-1.5 rounded-lg text-gray-400 dark:text-[#555] hover:text-gray-900 dark:hover:text-white transition-colors"
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
  const qc    = useQueryClient();

  const [customerName,  setCustomerName]  = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [duration,      setDuration]      = useState(60);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [customer,      setCustomer]      = useState<CustomerLookup | null>(null);
  const [lookingUp,     setLookingUp]     = useState(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const maxMins = table.upcomingBooking
    ? Math.max(15, Math.floor(
        (new Date(table.upcomingBooking.scheduled_start).getTime() - Date.now()) / 60000
      ) - 5)
    : 240;

  const availablePresets = DURATION_PRESETS.filter((p) => p.mins <= maxMins);

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
        if (data.found && data.customer?.name && !customerName.trim()) {
          setCustomerName(data.customer.name);
        }
        setLookingUp(false);
      }, 600);
    } else {
      setLookingUp(false);
    }
  }

  async function startWalkIn() {
    if (!customerName.trim()) { setError("Customer name is required"); return; }

    setLoading(true);
    setError(null);

    // Combined endpoint: creates order + starts session in one round trip
    const res = await fetch("/api/walkin/start", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        location_id:    locationId,
        customer_name:  customerName.trim(),
        customer_phone: customerPhone.trim() || undefined,
        items: [{
          table_id:      table.id,
          duration_mins: duration,
          rate_per_hour: table.hourly_rate,
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

    qc.invalidateQueries({ queryKey: ["pos-orders",  locationId] });
    qc.invalidateQueries({ queryKey: ["pos-tables",  locationId] });
    setLoading(false);
    // selectedTableId stays — panel auto-switches to PanelSession once data refreshes
  }

  return (
    <div className="flex flex-col h-full">
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
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-[#444]">
            Customer
          </p>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Customer name *"
            autoFocus
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors
              bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
              text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#444]
              focus:border-[#D4541A]"
          />
          <input
            type="tel"
            value={customerPhone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            placeholder="Phone (optional)"
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors
              bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
              text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#444]
              focus:border-[#D4541A]"
          />
          {lookingUp && (
            <p className="text-xs text-gray-400 dark:text-[#555]">Looking up...</p>
          )}
          {!lookingUp && customer && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.18)" }}
            >
              <Star className="h-3 w-3 shrink-0" style={{ color: "#f59e0b" }} />
              <span className="text-xs font-medium" style={{ color: "#fbbf24" }}>
                {customer.points_balance} pts · {customer.visit_count} visit{customer.visit_count !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          {!lookingUp && customerPhone.trim().length >= 6 && !customer && (
            <p className="text-xs text-gray-400 dark:text-[#444]">New customer</p>
          )}
        </div>

        {/* Duration */}
        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-[#444]">
            Duration
          </p>
          <div className="flex gap-2">
            {availablePresets.map((p) => (
              <button
                key={p.mins}
                onClick={() => setDuration(p.mins)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                  duration === p.mins
                    ? "text-white"
                    : "bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A] text-gray-600 dark:text-[#666]"
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
              value={duration}
              onChange={(e) =>
                setDuration(Math.min(maxMins, Math.max(15, parseInt(e.target.value) || 60)))
              }
              className="w-20 text-sm rounded-lg px-2.5 py-1.5 outline-none transition-colors
                bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
                text-gray-900 dark:text-white focus:border-[#D4541A]"
            />
            <span className="text-xs text-gray-400 dark:text-[#555]">mins</span>
            {table.upcomingBooking && (
              <span className="text-xs text-gray-400 dark:text-[#555]">(max {maxMins}m)</span>
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

      <div className="shrink-0 px-5 py-4 border-t border-gray-200 dark:border-[#1f1f1f]">
        <button
          onClick={startWalkIn}
          disabled={loading}
          className="w-full py-3 rounded-xl font-bold text-white text-sm transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: "#D4541A" }}
        >
          {loading ? "Starting..." : "Start Walk-in"}
        </button>
      </div>
    </div>
  );
}

// ─── Session: running or bill-ready order ─────────────────────────────────────

function PanelSession({
  locationId,
  order,
}: {
  locationId: string;
  order: POSOrder;
}) {
  const now               = usePOSStore((s) => s.now);
  const posTables         = usePOSStore((s) => s.tables);
  const pointsToRedeem    = usePOSStore((s) => s.pointsToRedeem);
  const patchOrderItem    = usePOSStore((s) => s.patchOrderItem);
  const addOrderExtra     = usePOSStore((s) => s.addOrderExtra);
  const removeOrderExtra  = usePOSStore((s) => s.removeOrderExtra);
  const setExtendModal    = usePOSStore((s) => s.setExtendModalItem);
  const setPointsToRedeem = usePOSStore((s) => s.setPointsToRedeem);
  const setFinalizeId     = usePOSStore((s) => s.setFinalizeOrderId);
  const setSelectedTableId = usePOSStore((s) => s.setSelectedTableId);
  const qc                = useQueryClient();

  const [addExtraOpen,  setAddExtraOpen]  = useState(false);
  const [extraForm,     setExtraForm]     = useState({ name: "", price: "", quantity: "1" });
  const [customerInfo,  setCustomerInfo]  = useState<{ points_balance: number } | null>(null);
  const [redeemInput,   setRedeemInput]   = useState(String(pointsToRedeem[order.id] ?? 0));

  const activeItems  = order.items.filter((i) => i.status !== "cancelled" && !i.is_deleted);
  const activeExtras = order.extras.filter((e) => !e.is_deleted);
  const bill         = calculateBill(activeItems, activeExtras, now, null, order.advance_paid ?? 0);
  const hasRunning   = activeItems.some((i) => i.status === "running");

  const redeemPoints  = Math.max(0, parseInt(redeemInput) || 0);
  const maxRedeem     = Math.min(customerInfo?.points_balance ?? 0, Math.floor(bill.totalDue));
  const clampedRedeem = Math.min(redeemPoints, maxRedeem);
  const displayTotal  = Math.max(0, Math.round((bill.totalDue - clampedRedeem) * 100) / 100);

  useEffect(() => {
    if (!order.customer_phone) return;
    fetch(`/api/customers/lookup?phone=${encodeURIComponent(order.customer_phone)}`)
      .then((r) => r.json())
      .then((data: { found: boolean; customer: { points_balance: number } | null }) => {
        setCustomerInfo(data.customer);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.customer_phone]);

  function handleRedeemChange(val: string) {
    setRedeemInput(val);
    const n = Math.max(0, parseInt(val) || 0);
    setPointsToRedeem(order.id, Math.min(n, maxRedeem));
  }

  async function stopSession(item: OrderItem) {
    const nowISO = new Date().toISOString();
    patchOrderItem(item.id, { status: "finished", actual_end: nowISO });
    const res = await fetch("/api/sessions/stop", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ order_item_id: item.id }),
    });
    if (!res.ok) {
      patchOrderItem(item.id, { status: "running", actual_end: null });
      toast.error("Failed to stop session");
    } else {
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    }
  }

  async function addExtra() {
    if (!extraForm.name || !extraForm.price) return;
    const tempId     = crypto.randomUUID();
    const optimistic: OrderExtra = {
      id:         tempId,
      order_id:   order.id,
      name:       extraForm.name,
      price:      parseFloat(extraForm.price),
      quantity:   parseInt(extraForm.quantity),
      is_deleted: false,
      deleted_at: null,
      added_by:   null,
      created_at: new Date().toISOString(),
    };
    addOrderExtra(order.id, optimistic);
    setExtraForm({ name: "", price: "", quantity: "1" });
    setAddExtraOpen(false);
    const res = await fetch(`/api/orders/${order.id}/extras`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        name:     optimistic.name,
        price:    optimistic.price,
        quantity: optimistic.quantity,
      }),
    });
    if (!res.ok) {
      removeOrderExtra(order.id, tempId);
      toast.error("Failed to add extra");
    } else {
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    }
  }

  async function deleteExtra(extraId: string) {
    removeOrderExtra(order.id, extraId);
    const res = await fetch(`/api/orders/${order.id}/extras/${extraId}`, { method: "DELETE" });
    if (!res.ok) qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
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
              <p className="text-xs text-gray-500 dark:text-[#666] mt-0.5 truncate">
                {order.customer_phone}
              </p>
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
          const hasNextBooking = !!tableInStore?.upcomingBooking;

          let countdown = "", elapsed = "";
          let isGrace = false;
          if (isRunning) {
            if (item.actual_start) elapsed = formatElapsed(new Date(item.actual_start), now);
            if (item.expected_end) {
              const exp  = new Date(item.expected_end);
              const otMs = Math.max(0, now.getTime() - exp.getTime());
              isGrace    = otMs > 0 && otMs <= AUTO_STOP_GRACE_MINS * 60 * 1000 && !hasNextBooking;
              countdown  = isGrace
                ? formatCountdown(new Date(exp.getTime() + AUTO_STOP_GRACE_MINS * 60 * 1000), now)
                : formatCountdown(exp, now);
            }
          }

          const progressPct =
            isRunning && item.actual_start && item.expected_end && !isGrace
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
                  ? isGrace
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
                        isGrace
                          ? { background: "rgba(245,158,11,0.1)", color: "#f59e0b" }
                          : { background: "rgba(16,185,129,0.1)", color: "#10b981" }
                      }
                    >
                      {isGrace ? "Grace" : "Live"}
                    </span>
                  )}
                  {item.status === "finished" && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide bg-gray-100 dark:bg-[#1A1A1A] text-gray-400 dark:text-[#555]">
                      Finished
                    </span>
                  )}
                  {item.status === "scheduled" && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                      style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}
                    >
                      Scheduled
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p
                    className="font-bold text-base tabular-nums"
                    style={{ color: isRunning ? "#D4541A" : undefined }}
                  >
                    {formatCurrency(lineBill)}
                  </p>
                  <p className="text-[10px] mt-0.5 text-gray-400 dark:text-[#444]">
                    ₹{item.rate_per_hour}/hr
                  </p>
                </div>
              </div>

              {/* Elapsed + countdown */}
              {isRunning && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#0a0a0a] border border-gray-100 dark:border-[#1a1a1a]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wide">Elapsed</span>
                    <span className="text-xs font-mono font-semibold tabular-nums text-gray-700 dark:text-[#aaa]">
                      {elapsed || "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isGrace ? (
                      <span className="text-xs font-mono font-semibold tabular-nums" style={{ color: "#f59e0b" }}>
                        {countdown} grace left
                      </span>
                    ) : (
                      <>
                        <span className="text-[10px] text-gray-400 uppercase tracking-wide">Left</span>
                        <span className="text-xs font-mono font-semibold tabular-nums" style={{ color: "#D4541A" }}>
                          {countdown}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Progress bar */}
              {isRunning && (progressPct > 0 || isGrace) && (
                <div className="h-1.5 rounded-full overflow-hidden bg-gray-100 dark:bg-[#1A1A1A]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width:      isGrace ? "100%" : `${progressPct}%`,
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
            {activeExtras.length === 0 && !addExtraOpen && (
              <p className="text-xs py-1.5 text-gray-400 dark:text-[#444]">None added</p>
            )}
            {activeExtras.map((extra) => (
              <div key={extra.id} className="flex items-center justify-between py-1 px-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-gray-900 dark:text-white truncate">{extra.name}</span>
                  <span className="text-xs shrink-0 text-gray-400 dark:text-[#555]">×{extra.quantity}</span>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {formatCurrency(extra.price * extra.quantity)}
                  </span>
                  <button
                    onClick={() => deleteExtra(extra.id)}
                    className="text-gray-400 hover:text-red-400 transition-colors"
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
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors
                    bg-gray-50 dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a]
                    text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#444]
                    focus:border-[#D4541A]"
                  autoFocus
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Price (₹)"
                    value={extraForm.price}
                    onChange={(e) => setExtraForm({ ...extraForm, price: e.target.value })}
                    className="flex-1 px-3 py-2 rounded-lg text-sm outline-none transition-colors
                      bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
                      text-gray-900 dark:text-white placeholder-gray-400 focus:border-[#D4541A]"
                  />
                  <input
                    type="number"
                    placeholder="Qty"
                    value={extraForm.quantity}
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

      {/* Pinned bill footer */}
      <div className="shrink-0 bg-white dark:bg-[#111] border-t border-gray-200 dark:border-[#1f1f1f]">
        <div className="px-5 pt-3 pb-1 max-h-36 overflow-y-auto space-y-1">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-gray-400 dark:text-[#555] mb-2">
            Receipt
          </p>
          {bill.tableLines.map((line) => {
            const ti = activeItems.find((i) => i.id === line.id);
            const tn = (ti?.table as { name?: string } | null)?.name ?? "Table";
            return (
              <div key={line.id} className="flex justify-between items-baseline gap-2 py-0.5">
                <span className="truncate text-xs font-medium text-gray-800 dark:text-[#ccc]">
                  {tn} · {line.durationMins}m
                </span>
                <span className="shrink-0 font-bold text-gray-900 dark:text-white tabular-nums text-xs">
                  {formatCurrency(line.amount)}
                </span>
              </div>
            );
          })}
          {bill.extraLines.map((line) => (
            <div key={line.id} className="flex justify-between items-baseline gap-2 py-0.5">
              <span className="truncate text-xs font-medium text-gray-800 dark:text-[#ccc]">
                {line.name} ×{line.quantity}
              </span>
              <span className="shrink-0 font-bold text-gray-900 dark:text-white tabular-nums text-xs">
                {formatCurrency(line.amount)}
              </span>
            </div>
          ))}
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
                −{formatCurrency(clampedRedeem)}
              </span>
            </div>
          )}
        </div>

        {/* Loyalty points row — only when bill is ready */}
        {!hasRunning && order.customer_phone && customerInfo && customerInfo.points_balance > 0 && (
          <div className="px-5 py-2.5 border-t border-gray-100 dark:border-[#1a1a1a] flex items-center gap-2">
            <Star className="h-3 w-3 shrink-0" style={{ color: "#f59e0b" }} />
            <span className="text-xs text-gray-400 dark:text-[#555] flex-1">
              {customerInfo.points_balance} pts
            </span>
            <input
              type="number"
              min="0"
              max={maxRedeem}
              value={redeemInput}
              onChange={(e) => handleRedeemChange(e.target.value)}
              placeholder="0"
              className="w-16 text-xs rounded-lg px-2 py-1 outline-none text-center tabular-nums
                bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
                text-gray-900 dark:text-white focus:border-[#f59e0b]"
            />
            <span className="text-xs text-gray-400 dark:text-[#555] shrink-0">/ {maxRedeem} max</span>
          </div>
        )}

        <div className="px-5 pb-5 pt-3 border-t border-gray-100 dark:border-[#1a1a1a]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-[#555]">
              Total due
            </span>
            <span className="text-2xl font-bold tabular-nums leading-none" style={{ color: "#D4541A" }}>
              {formatCurrency(hasRunning ? bill.totalDue : displayTotal)}
            </span>
          </div>
          <button
            onClick={() => setFinalizeId(order.id)}
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
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

function ContextPanelInner({ locationId }: { locationId: string }) {
  const tables          = usePOSStore((s) => s.tables);
  const openOrders      = usePOSStore((s) => s.openOrders);
  const selectedTableId = usePOSStore((s) => s.selectedTableId);

  const table = tables.find((t) => t.id === selectedTableId) ?? null;
  if (!table) return null;

  const item      = table.activeOrderItem;
  const isRunning = !!item && item.status === "running";

  const billReadyOrder = !isRunning
    ? openOrders.find((o) => {
        const live = o.items.filter((i) => !i.is_deleted);
        return (
          live.some((i) => i.table_id === table.id && i.status === "finished") &&
          !live.some((i) => i.status === "running")
        );
      })
    : undefined;

  const isBillReady      = !!billReadyOrder;
  const minsUntilBooking = table.upcomingBooking
    ? (new Date(table.upcomingBooking.scheduled_start).getTime() - Date.now()) / 60000
    : Infinity;
  const isBooked = !isRunning && !isBillReady && !!table.upcomingBooking && minsUntilBooking <= 30;
  const isIdle   = !isRunning && !isBillReady && !isBooked;

  const runningOrder = isRunning
    ? openOrders.find((o) => o.items.some((i) => i.id === item!.id))
    : null;

  // Booked tables: actions live on the card — no panel needed
  if (isBooked) return null;

  if (isIdle)                        return <PanelWalkIn  locationId={locationId} table={table} />;
  if (isRunning && runningOrder)     return <PanelSession locationId={locationId} order={runningOrder} />;
  if (isBillReady && billReadyOrder) return <PanelSession locationId={locationId} order={billReadyOrder} />;

  return null;
}

export const ContextPanel = memo(ContextPanelInner);
