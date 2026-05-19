"use client";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { calculateBill } from "@/lib/billing/engine";
import { formatCurrency } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Banknote, Smartphone, Star, CheckCircle2 } from "lucide-react";
import type { Order, Booking } from "@/lib/supabase/types";

interface FinalizeBillModalProps {
  locationId: string;
}

type PaymentMethod = "cash" | "upi";

interface CustomerInfo {
  points_balance: number;
  name: string | null;
}

type HandoverBooking = Pick<Booking, "id" | "scheduled_start" | "scheduled_end"> & {
  order: Pick<Order, "customer_name" | "customer_phone">;
};

export function FinalizeBillModal({ locationId }: FinalizeBillModalProps) {
  const store         = usePOSStore();
  const isOpen        = !!store.finalizeOrderId;
  const selectedOrder = store.openOrders.find((o) => o.id === store.finalizeOrderId) ?? null;
  const qc            = useQueryClient();
  const now           = store.now;

  const orderId     = store.finalizeOrderId;
  const savedPoints = orderId ? (store.pointsToRedeem[orderId] ?? 0) : 0;

  const [method,           setMethod]           = useState<PaymentMethod | null>(null);
  const [loading,          setLoading]          = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [customerInfo,     setCustomerInfo]     = useState<CustomerInfo | null>(null);
  const [redeemInput,      setRedeemInput]      = useState(String(savedPoints));
  const [step,             setStep]             = useState<"bill" | "handover">("bill");
  const [handoverBookings, setHandoverBookings] = useState<HandoverBooking[]>([]);
  const [handoverLoading,  setHandoverLoading]  = useState<string | null>(null);
  const [manualPhone,      setManualPhone]      = useState("");

  const redeemPoints = Math.max(0, parseInt(redeemInput) || 0);

  const activeItems  = selectedOrder?.items.filter((i) => i.status !== "cancelled" && !i.is_deleted) ?? [];
  const activeExtras = selectedOrder?.extras.filter((e) => !e.is_deleted) ?? [];

  const bill          = calculateBill(activeItems, activeExtras, now, null, selectedOrder?.advance_paid ?? 0);
  const fullyPrePaid  = bill.advancePaid > 0 && bill.advancePaid >= bill.scheduledSubtotal;
  const maxRedeem     = Math.min(customerInfo?.points_balance ?? 0, Math.floor(bill.totalDue));
  const clampedRedeem = Math.min(redeemPoints, maxRedeem);
  const finalDue      = Math.max(0, Math.round((bill.totalDue - clampedRedeem) * 100) / 100);
  const pointsToEarn  = Math.floor(finalDue / 100);

  const phoneForLookup = selectedOrder?.customer_phone ?? (manualPhone.length >= 10 ? manualPhone : null);

  useEffect(() => {
    setCustomerInfo(null);
    if (!isOpen || !phoneForLookup) return;
    fetch(`/api/customers/lookup?phone=${encodeURIComponent(phoneForLookup)}`)
      .then((r) => r.json())
      .then((data: { found: boolean; customer: CustomerInfo | null }) => setCustomerInfo(data.customer))
      .catch(() => {});
  }, [isOpen, phoneForLookup]);

  useEffect(() => {
    setRedeemInput(String(savedPoints));
  }, [savedPoints, isOpen]);

  function handleRedeemChange(val: string) {
    setRedeemInput(val);
    const n = Math.max(0, parseInt(val) || 0);
    if (orderId) store.setPointsToRedeem(orderId, Math.min(n, maxRedeem));
  }

  function close() {
    store.setFinalizeOrderId(null);
    setMethod(null);
    setError(null);
    setStep("bill");
    setHandoverBookings([]);
    setHandoverLoading(null);
    setManualPhone("");
  }

  async function confirmPayment() {
    if (!method || !store.finalizeOrderId) return;
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/orders/${store.finalizeOrderId}/finalize`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment_method:  method,
        points_redeemed: clampedRedeem,
        ...(manualPhone && !selectedOrder?.customer_phone ? { customer_phone: manualPhone } : {}),
      }),
    });

    const body = await res.json() as
      | { success: true;  data: { total_due: number; points_earned: number } }
      | { success: false; error: string };

    if (!body.success) {
      setError(body.error);
      setLoading(false);
      return;
    }

    // Capture handovers from current table state BEFORE queries invalidate
    const finalizedTableIds = new Set((selectedOrder?.items ?? []).map((i) => i.table_id));
    const handovers: HandoverBooking[] = store.tables
      .filter((t) => finalizedTableIds.has(t.id) && t.upcomingBooking !== null)
      .map((t) => ({
        id:              t.upcomingBooking!.id,
        scheduled_start: t.upcomingBooking!.scheduled_start,
        scheduled_end:   t.upcomingBooking!.scheduled_end,
        order:           t.upcomingBooking!.order,
      }));

    qc.invalidateQueries({ queryKey: ["pos-orders",   locationId] });
    qc.invalidateQueries({ queryKey: ["pos-tables",   locationId] });
    qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
    store.selectOrder(null);
    setLoading(false);

    if (handovers.length > 0) {
      setHandoverBookings(handovers);
      setStep("handover");
    } else {
      close();
    }
  }

  async function doCheckIn(bookingId: string) {
    setHandoverLoading(bookingId);
    const res  = await fetch(`/api/bookings/${bookingId}/checkin`, { method: "POST" });
    const body = await res.json() as
      | { success: true;  data: { order_id: string } }
      | { success: false; error: string };

    if (body.success) {
      qc.invalidateQueries({ queryKey: ["pos-orders",   locationId] });
      qc.invalidateQueries({ queryKey: ["pos-tables",   locationId] });
      qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
      store.selectOrder(body.data.order_id);
    }
    close();
  }

  const paymentMethods: { value: PaymentMethod; label: string; icon: React.ReactNode }[] = [
    { value: "cash", label: "Cash", icon: <Banknote   className="h-5 w-5" /> },
    { value: "upi",  label: "UPI",  icon: <Smartphone className="h-5 w-5" /> },
  ];

  if (step === "handover") {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden bg-white dark:bg-[#111] border border-gray-200 dark:border-[#2A2A2A]">
          <div className="px-5 py-6 space-y-5">
            {/* Success indicator */}
            <div className="text-center space-y-2">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto"
                style={{ background: "rgba(16,185,129,0.1)" }}
              >
                <CheckCircle2 className="h-6 w-6" style={{ color: "#10b981" }} />
              </div>
              <div>
                <p className="font-bold text-gray-900 dark:text-white">Payment collected!</p>
                <p className="text-xs mt-0.5 text-gray-400 dark:text-[#555]">
                  {handoverBookings.length === 1
                    ? "Next booking is ready to check in"
                    : `${handoverBookings.length} upcoming bookings ready`}
                </p>
              </div>
            </div>

            {/* Handover cards */}
            <div className="space-y-3">
              {handoverBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="rounded-xl p-4 bg-white dark:bg-[#111] border-2 border-amber-200 dark:border-[rgba(245,158,11,0.3)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-gray-900 dark:text-white text-sm truncate">
                        {booking.order.customer_name}
                      </p>
                      {booking.order.customer_phone && (
                        <p className="text-xs mt-0.5 text-gray-400 dark:text-[#555]">
                          {booking.order.customer_phone}
                        </p>
                      )}
                      <p className="text-xs font-mono font-semibold mt-1.5 tabular-nums" style={{ color: "#f59e0b" }}>
                        {new Date(booking.scheduled_start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        {" → "}
                        {new Date(booking.scheduled_end).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                    <button
                      onClick={() => doCheckIn(booking.id)}
                      disabled={!!handoverLoading}
                      className="shrink-0 px-4 py-2 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-85 disabled:opacity-40"
                      style={{ background: "#10b981" }}
                    >
                      {handoverLoading === booking.id ? "…" : "Check In"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Skip */}
            <button
              onClick={close}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-gray-500 dark:text-[#555] hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Skip for now
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden bg-white dark:bg-[#111] border border-gray-200 dark:border-[#2A2A2A]">
        <DialogHeader className="px-5 pt-5 pb-4 border-b border-gray-200 dark:border-[#1F1F1F]">
          <DialogTitle className="text-gray-900 dark:text-white text-base font-bold">Finalize Bill</DialogTitle>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 max-h-[80vh] overflow-y-auto">

          {/* Bill breakdown */}
          <div className="rounded-xl p-4 space-y-2 text-sm bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#1F1F1F]">
            {fullyPrePaid ? (
              <>
                <div className="flex justify-between text-xs" style={{ color: "#10b981" }}>
                  <span>Session pre-paid online</span><span>✓ covered</span>
                </div>
                {bill.tableLines.filter((l) => l.overtimeMins > 0).map((line) => {
                  const ti = activeItems.find((i) => i.id === line.id);
                  const tn = (ti?.table as { name?: string } | null)?.name ?? "Table";
                  return (
                    <div key={line.id} className="flex justify-between">
                      <span className="text-gray-500 dark:text-[#888]">{tn} — overtime {line.overtimeMins}m</span>
                      <span className="text-gray-900 dark:text-white">{formatCurrency(line.overtimeAmount)}</span>
                    </div>
                  );
                })}
              </>
            ) : (
              bill.tableLines.map((line) => {
                const ti = activeItems.find((i) => i.id === line.id);
                const tn = (ti?.table as { name?: string } | null)?.name ?? "Table";
                return (
                  <div key={line.id} className="flex justify-between">
                    <span className="text-gray-500 dark:text-[#888]">{tn} ({line.durationMins}m)</span>
                    <span className="text-gray-900 dark:text-white">{formatCurrency(line.amount)}</span>
                  </div>
                );
              })
            )}

            {bill.extraLines.map((line) => (
              <div key={line.id} className="flex justify-between">
                <span className="text-gray-500 dark:text-[#888]">{line.name} ×{line.quantity}</span>
                <span className="text-gray-900 dark:text-white">{formatCurrency(line.amount)}</span>
              </div>
            ))}

            {!fullyPrePaid && (
              <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-[#2A2A2A]">
                <span className="text-gray-500 dark:text-[#666]">Subtotal</span>
                <span className="text-gray-900 dark:text-white">{formatCurrency(bill.subtotal)}</span>
              </div>
            )}

            {bill.discountAmount > 0 && (
              <div className="flex justify-between">
                <span style={{ color: "#10b981" }}>Discount</span>
                <span style={{ color: "#10b981" }}>−{formatCurrency(bill.discountAmount)}</span>
              </div>
            )}
            {!fullyPrePaid && bill.advancePaid > 0 && (
              <div className="flex justify-between">
                <span style={{ color: "#10b981" }}>Advance paid</span>
                <span style={{ color: "#10b981" }}>−{formatCurrency(bill.advancePaid)}</span>
              </div>
            )}
            {clampedRedeem > 0 && (
              <div className="flex justify-between">
                <span style={{ color: "#f59e0b" }}>Points ({clampedRedeem} pts)</span>
                <span style={{ color: "#f59e0b" }}>−{formatCurrency(clampedRedeem)}</span>
              </div>
            )}

            <div className="flex justify-between text-base font-bold pt-2 border-t border-gray-200 dark:border-[#2A2A2A]">
              <span className="text-gray-900 dark:text-white">Total Due</span>
              <span style={{ color: "#D4541A" }}>{formatCurrency(finalDue)}</span>
            </div>
          </div>

          {/* Loyalty points */}
          <div className="rounded-xl p-4 space-y-2.5 bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#1F1F1F]">
            <div className="flex items-center gap-2">
              <Star className="h-3.5 w-3.5" style={{ color: "#f59e0b" }} />
              <span className="text-sm font-semibold text-gray-900 dark:text-white">Loyalty Points</span>
            </div>

            {/* Phone entry when walk-in had no phone */}
            {!selectedOrder?.customer_phone && (
              <input
                type="tel"
                placeholder="Enter customer phone"
                value={manualPhone}
                onChange={(e) => { setManualPhone(e.target.value); setCustomerInfo(null); }}
                className="w-full text-sm rounded-lg px-3 py-1.5 outline-none transition-colors
                  bg-gray-100 dark:bg-[#1A1A1A]
                  border border-gray-200 dark:border-[#2A2A2A]
                  text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#444]
                  focus:border-[#f59e0b]"
              />
            )}

            {phoneForLookup && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400 dark:text-[#555]">Balance</span>
                <span className="text-xs font-semibold" style={{ color: "#f59e0b" }}>
                  {customerInfo ? `${customerInfo.points_balance} pts` : "Looking up…"}
                </span>
              </div>
            )}

            {customerInfo && customerInfo.points_balance > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs shrink-0 text-gray-500 dark:text-[#666]">Redeem</span>
                <input
                  type="number"
                  min="0"
                  max={maxRedeem}
                  value={redeemInput}
                  onChange={(e) => handleRedeemChange(e.target.value)}
                  className="w-20 text-sm rounded-lg px-2 py-1 outline-none transition-colors
                    bg-gray-100 dark:bg-[#1A1A1A]
                    border border-gray-200 dark:border-[#2A2A2A]
                    text-gray-900 dark:text-white
                    focus:border-[#f59e0b]"
                />
                <span className="text-xs text-gray-400 dark:text-[#555]">/ {maxRedeem} max</span>
              </div>
            )}

            <p className="text-xs text-gray-400 dark:text-[#555]">
              Will earn{" "}
              <span className="font-semibold" style={{ color: "#f59e0b" }}>{pointsToEarn} pts</span>{" "}
              from this visit
            </p>
          </div>

          {/* Payment method */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-[#444]">
              Payment method
            </p>
            <div className="grid grid-cols-2 gap-2">
              {paymentMethods.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setMethod(opt.value)}
                  className={`flex flex-col items-center gap-2 py-3 rounded-xl transition-all ${
                    method === opt.value
                      ? ""
                      : "bg-gray-100 dark:bg-[#161616] border border-gray-200 dark:border-[#2A2A2A] text-gray-500 dark:text-[#888]"
                  }`}
                  style={
                    method === opt.value
                      ? { background: "rgba(212,84,26,0.1)", border: "1px solid #D4541A", color: "#D4541A" }
                      : {}
                  }
                >
                  {opt.icon}
                  <span className="text-xs font-semibold">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p
              className="text-sm rounded-lg px-3 py-2"
              style={{ background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              {error}
            </p>
          )}

          <button
            onClick={confirmPayment}
            disabled={!method || loading}
            className="w-full py-3.5 rounded-xl font-bold text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-30"
            style={{ background: "#D4541A" }}
          >
            {loading ? "Processing..." : `Collect ${formatCurrency(finalDue)}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
