"use client";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePOSStore, getSelectedOrder } from "@/store/pos";
import { calculateBill } from "@/lib/billing/engine";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Banknote, Smartphone, CreditCard, Star } from "lucide-react";

interface FinalizeBillModalProps {
  locationId: string;
}

type PaymentMethod = "cash" | "upi" | "card";

interface CustomerInfo {
  points_balance: number;
  name: string | null;
}

export function FinalizeBillModal({ locationId }: FinalizeBillModalProps) {
  const store         = usePOSStore();
  const selectedOrder = getSelectedOrder(store);
  const isOpen        = !!store.finalizeOrderId;
  const qc            = useQueryClient();
  const now           = store.now;

  const orderId       = store.finalizeOrderId;
  const savedPoints   = orderId ? (store.pointsToRedeem[orderId] ?? 0) : 0;

  const [method,       setMethod]       = useState<PaymentMethod | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [redeemInput,  setRedeemInput]  = useState(String(savedPoints));

  const redeemPoints = Math.max(0, parseInt(redeemInput) || 0);

  const activeItems =
    selectedOrder?.items.filter((i) => i.status !== "cancelled" && !i.is_deleted) ?? [];
  const activeExtras =
    selectedOrder?.extras.filter((e) => !e.is_deleted) ?? [];

  const bill      = calculateBill(activeItems, activeExtras, now);
  const maxRedeem = Math.min(customerInfo?.points_balance ?? 0, Math.floor(bill.totalDue));
  const clampedRedeem  = Math.min(redeemPoints, maxRedeem);
  const finalDue       = Math.max(0, Math.round((bill.totalDue - clampedRedeem) * 100) / 100);
  const pointsToEarn   = Math.floor(finalDue / 100);

  // Load customer info when modal opens
  useEffect(() => {
    if (!isOpen || !selectedOrder?.customer_phone) {
      setCustomerInfo(null);
      return;
    }
    fetch(`/api/customers/lookup?phone=${encodeURIComponent(selectedOrder.customer_phone)}`)
      .then((r) => r.json())
      .then((data: { found: boolean; customer: CustomerInfo | null }) => {
        setCustomerInfo(data.customer);
      })
      .catch(() => setCustomerInfo(null));
  }, [isOpen, selectedOrder?.customer_phone]);

  // Sync redeemInput when savedPoints changes (e.g. modal re-opens)
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

    qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    qc.invalidateQueries({ queryKey: ["pos-tables", locationId] });
    store.selectOrder(null);
    close();
    setLoading(false);
  }

  const methodOptions: { value: PaymentMethod; label: string; icon: React.ReactNode }[] = [
    { value: "cash", label: "Cash",  icon: <Banknote  className="h-5 w-5" /> },
    { value: "upi",  label: "UPI",   icon: <Smartphone className="h-5 w-5" /> },
    { value: "card", label: "Card",  icon: <CreditCard className="h-5 w-5" /> },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle>Finalize Bill</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Bill breakdown */}
          <div className="bg-gray-700 rounded-lg p-4 space-y-2 text-sm">
            {bill.tableLines.map((line) => (
              <div key={line.id} className="flex justify-between">
                <span className="text-gray-300">{line.label} ({line.durationMins}m)</span>
                <span className="text-white">{formatCurrency(line.amount)}</span>
              </div>
            ))}
            {bill.extraLines.map((line) => (
              <div key={line.id} className="flex justify-between">
                <span className="text-gray-300">{line.name} ×{line.quantity}</span>
                <span className="text-white">{formatCurrency(line.amount)}</span>
              </div>
            ))}
            <div className="border-t border-gray-600 pt-2 flex justify-between font-medium">
              <span className="text-gray-300">Subtotal</span>
              <span className="text-white">{formatCurrency(bill.subtotal)}</span>
            </div>
            {bill.discountAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-green-400">Discount</span>
                <span className="text-green-400">-{formatCurrency(bill.discountAmount)}</span>
              </div>
            )}
            {bill.advancePaid > 0 && (
              <div className="flex justify-between">
                <span className="text-green-400">Advance paid</span>
                <span className="text-green-400">-{formatCurrency(bill.advancePaid)}</span>
              </div>
            )}
            {clampedRedeem > 0 && (
              <div className="flex justify-between">
                <span className="text-amber-400">Points redeemed ({clampedRedeem} pts)</span>
                <span className="text-amber-400">-{formatCurrency(clampedRedeem)}</span>
              </div>
            )}
            <div className="border-t border-gray-600 pt-2 flex justify-between text-lg font-bold">
              <span>Total Due</span>
              <span className="text-green-400">{formatCurrency(finalDue)}</span>
            </div>
          </div>

          {/* Loyalty points */}
          {selectedOrder?.customer_phone && (
            <div className="bg-gray-700 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Star className="h-4 w-4 text-amber-400" />
                  <span className="text-sm font-medium text-white">Loyalty Points</span>
                </div>
                <span className="text-xs text-amber-300">
                  {customerInfo ? `${customerInfo.points_balance} available` : "Loading..."}
                </span>
              </div>

              {customerInfo && customerInfo.points_balance > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 shrink-0">Redeem</span>
                  <input
                    type="number"
                    min="0"
                    max={maxRedeem}
                    value={redeemInput}
                    onChange={(e) => handleRedeemChange(e.target.value)}
                    className="w-20 bg-gray-600 border border-gray-500 text-white text-sm rounded px-2 py-1"
                  />
                  <span className="text-xs text-gray-400">/ {maxRedeem} pts (₹{maxRedeem})</span>
                </div>
              )}

              <p className="text-xs text-gray-500">
                Will earn <span className="text-amber-300 font-medium">{pointsToEarn} pts</span> from this visit
              </p>
            </div>
          )}

          {/* Payment method */}
          <div className="space-y-2">
            <p className="text-sm text-gray-400">Payment method</p>
            <div className="grid grid-cols-3 gap-2">
              {methodOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setMethod(opt.value)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
                    method === opt.value
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-gray-600 hover:border-gray-400"
                  }`}
                >
                  {opt.icon}
                  <span className="text-xs">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Button
            className="w-full bg-green-600 hover:bg-green-700 font-bold"
            size="lg"
            onClick={confirmPayment}
            disabled={!method || loading}
          >
            {loading ? "Processing..." : `Collect ${formatCurrency(finalDue)}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
