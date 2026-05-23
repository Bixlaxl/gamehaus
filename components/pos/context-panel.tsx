"use client";

import { useState, useRef, memo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import type { InventoryItem } from "@/lib/supabase/types";
import { calculateBill } from "@/lib/billing/engine";

const AUTO_STOP_GRACE_MINS = 2;
import { formatCurrency, formatCountdown } from "@/lib/utils";
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
    // Digits only, max 10
    const cleaned = val.replace(/\D/g, "").slice(0, 10);
    setCustomerPhone(cleaned);
    setCustomer(null);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (cleaned.length === 10) {
      setLookingUp(true);
      lookupTimer.current = setTimeout(async () => {
        const res  = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(cleaned)}`);
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

  function handleNameChange(val: string) {
    // Letters and spaces only
    setCustomerName(val.replace(/[^a-zA-Z\s]/g, ""));
  }

  async function startWalkIn() {
    if (!customerName.trim() || customerName.trim().length < 2) { setError("Customer name is required"); return; }
    if (customerPhone && customerPhone.length !== 10) { setError("Phone must be exactly 10 digits"); return; }

    setLoading(true);
    setError(null);

    // Combined endpoint: creates order + starts session in one round trip
    const res = await fetch("/api/walkin", {
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
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Customer name *"
            autoFocus
            autoComplete="name"
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors
              bg-gray-100 dark:bg-[#1A1A1A] border border-gray-200 dark:border-[#2A2A2A]
              text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-[#444]
              focus:border-[#D4541A]"
          />
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={10}
            value={customerPhone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            placeholder="10-digit phone (optional)"
            autoComplete="tel"
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
          {!lookingUp && customerPhone.length === 10 && !customer && (
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
  const setExtendModal    = usePOSStore((s) => s.setExtendModalItem);
  const setPointsToRedeem = usePOSStore((s) => s.setPointsToRedeem);
  const setFinalizeId     = usePOSStore((s) => s.setFinalizeOrderId);
  const setSelectedTableId = usePOSStore((s) => s.setSelectedTableId);
  const qc                = useQueryClient();

  const [addExtraOpen,   setAddExtraOpen]   = useState(false);
  const [extraForm,      setExtraForm]      = useState({ name: "", price: "", quantity: "1" });
  const [redeemInput,    setRedeemInput]    = useState(String(pointsToRedeem[order.id] ?? 0));

  // Catalogue is always visible in the panel — fetch on mount, cache 5 min
  const { data: inventoryItems } = useQuery<InventoryItem[]>({
    queryKey: ["inventory", locationId],
    queryFn: async () => {
      const res  = await fetch(`/api/inventory?location_id=${locationId}`);
      const body = await res.json() as { success: true; data: InventoryItem[] } | { success: false; error: string };
      if (!body.success) return [];
      return body.data.filter((i) => i.is_active);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Cached across order opens — same phone won't re-fetch within 60s
  const { data: customerInfo } = useQuery<{ points_balance: number } | null>({
    queryKey: ["customer-lookup", order.customer_phone],
    queryFn: async () => {
      if (!order.customer_phone) return null;
      const res  = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(order.customer_phone)}`);
      const body = await res.json() as { found: boolean; customer: { points_balance: number } | null };
      return body.customer;
    },
    enabled: !!order.customer_phone,
    staleTime: 60 * 1000,
  });

  const activeItems  = order.items.filter((i) => i.status !== "cancelled" && !i.is_deleted);
  const activeExtras = order.extras.filter((e) => !e.is_deleted);
  const bill         = calculateBill(activeItems, activeExtras, now, null, order.advance_paid ?? 0);
  const hasRunning   = activeItems.some((i) => i.status === "running");

  const redeemPoints  = Math.max(0, parseInt(redeemInput) || 0);
  const maxRedeem     = Math.min(customerInfo?.points_balance ?? 0, Math.floor(bill.totalDue));
  const clampedRedeem = Math.min(redeemPoints, maxRedeem);
  const displayTotal  = Math.max(0, Math.round((bill.totalDue - clampedRedeem) * 100) / 100);

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

  async function addExtraItem(opts: {
    name: string;
    price: number;
    cost_price?: number;
    quantity: number;
    inventory_item_id?: string;
  }) {
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
    setAddExtraOpen(false);
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
    } else {
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    }
  }

  async function addCustomExtra() {
    if (!extraForm.name || !extraForm.price) return;
    await addExtraItem({
      name:     extraForm.name,
      price:    parseFloat(extraForm.price),
      quantity: parseInt(extraForm.quantity) || 1,
    });
    setExtraForm({ name: "", price: "", quantity: "1" });
  }

  async function deleteExtra(extraId: string) {
    removeOrderExtra(order.id, extraId);
    const res = await fetch(`/api/orders/${order.id}/extras/${extraId}`, { method: "DELETE" });
    if (!res.ok) qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
  }

  // ─── Inventory quantity stepper helpers ───────────────────────────────────
  async function patchExtraQuantity(extraId: string, newQuantity: number, prevQuantity: number) {
    patchOrderExtra(order.id, extraId, { quantity: newQuantity });
    const res = await fetch(`/api/orders/${order.id}/extras/${extraId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ quantity: newQuantity }),
    });
    if (!res.ok) {
      patchOrderExtra(order.id, extraId, { quantity: prevQuantity });
      toast.error("Failed to update quantity");
    } else {
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
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
          const upcomingForItem = tableInStore?.upcomingBooking ?? null;
          // Mins of usable extension between this session and the next booking
          const gapToNextMins = (() => {
            if (!upcomingForItem || !item.expected_end) return Infinity;
            const ms = new Date(upcomingForItem.scheduled_start).getTime() - new Date(item.expected_end).getTime();
            return Math.max(0, Math.floor(ms / 60000));
          })();
          // Extend allowed if there's no next booking OR if at least 15 min gap
          const canExtend      = gapToNextMins >= 15;
          const hasNextBooking = !!upcomingForItem;

          let countdown = "";
          let isGrace = false;
          if (isRunning) {
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

              {/* Start time + countdown */}
              {isRunning && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-[#0a0a0a] border border-gray-100 dark:border-[#1a1a1a]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wide">Started</span>
                    <span className="text-xs font-mono font-semibold tabular-nums text-gray-700 dark:text-[#aaa]">
                      {item.actual_start ? fmtTime(item.actual_start) : "—"}
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

        {/* Extras — catalogue always visible, no toggle, no Cancel obstacle */}
        <div className="rounded-2xl overflow-hidden bg-white dark:bg-[#0d0d0d] border border-gray-100 dark:border-[#1f1f1f] shadow-sm">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-[#1f1f1f]">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-[#444]">
              Extras
            </p>
            <button
              onClick={() => setAddExtraOpen((v) => !v)}
              className="flex items-center gap-1 text-xs font-semibold transition-colors hover:brightness-75"
              style={{ color: "#D4541A" }}
            >
              <Plus className="h-3 w-3" /> {addExtraOpen ? "Hide custom" : "Custom item"}
            </button>
          </div>

          {/* Catalogue — clickable in place, no two-step process */}
          <div className="p-3 space-y-1.5 max-h-72 overflow-y-auto">
            {(inventoryItems ?? []).length === 0 && (
              <p className="text-xs text-gray-400 dark:text-[#555] py-2 text-center">
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
                    bg-gray-50 dark:bg-[#111] border border-gray-100 dark:border-[#222]"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 dark:text-[#ccc] truncate">{item.name}</p>
                    <p className="text-[10px] text-gray-400 dark:text-[#555]">₹{item.selling_price}</p>
                  </div>
                  {qty === 0 ? (
                    <button
                      onClick={() => incrementInventoryItem(item)}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-md text-white transition-opacity hover:opacity-85"
                      style={{ background: "#D4541A" }}
                    >
                      ADD
                    </button>
                  ) : (
                    <div
                      className="flex items-center rounded-md overflow-hidden"
                      style={{ border: "1px solid #D4541A" }}
                    >
                      <button
                        onClick={() => decrementInventoryItem(item.id)}
                        className="w-7 h-7 flex items-center justify-center text-sm font-bold transition-colors
                          hover:bg-orange-50 dark:hover:bg-[#1a0d00]"
                        style={{ color: "#D4541A" }}
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span
                        className="w-6 text-center text-xs font-bold tabular-nums"
                        style={{ color: "#D4541A" }}
                      >
                        {qty}
                      </span>
                      <button
                        onClick={() => incrementInventoryItem(item)}
                        className="w-7 h-7 flex items-center justify-center text-sm font-bold transition-colors
                          hover:bg-orange-50 dark:hover:bg-[#1a0d00]"
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

          {/* Custom items list — only shown if any non-catalogue extras exist */}
          {activeExtras.some((e) => !e.inventory_item_id) && (
            <div className="border-t border-gray-100 dark:border-[#1f1f1f] px-3 pt-2 pb-3 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-[#444] mb-1">
                Custom items
              </p>
              {activeExtras
                .filter((e) => !e.inventory_item_id)
                .map((extra) => (
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
                        aria-label="Remove custom item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* Custom item form — collapsed by default, only shows when toggled */}
          {addExtraOpen && (
            <div className="border-t border-gray-100 dark:border-[#1f1f1f] p-3 space-y-2">
              <input
                placeholder="Item name"
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
              <button
                onClick={addCustomExtra}
                disabled={!extraForm.name || !extraForm.price}
                className="w-full py-2 rounded-lg text-white text-xs font-bold transition-opacity hover:opacity-85 disabled:opacity-40"
                style={{ background: "#D4541A" }}
              >
                Add to order
              </button>
            </div>
          )}
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

          {/* Extend-from-bill — only when bill is ready (session finished) */}
          {!hasRunning && finishedItem && (
            <div className="mb-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-[#555] mb-1.5">
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
                <p className="text-[10px] mt-1.5 text-gray-400 dark:text-[#555]">
                  {upcomingForFinishedTable ? "Next booking too close to extend" : "Shop closing — extension unavailable"}
                </p>
              )}
            </div>
          )}

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

function ContextPanelInner({ locationId, closingTime }: { locationId: string; closingTime: string }) {
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
  if (isRunning && runningOrder)     return <PanelSession locationId={locationId} order={runningOrder} closingTime={closingTime} />;
  if (isBillReady && billReadyOrder) return <PanelSession locationId={locationId} order={billReadyOrder} closingTime={closingTime} />;

  return null;
}

export const ContextPanel = memo(ContextPanelInner);
