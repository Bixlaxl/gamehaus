"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { calculateBill, computeFreeHoursDiscount } from "@/lib/billing/engine";
import { formatCurrency, cleanErrorMessage } from "@/lib/utils";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Banknote, Smartphone, Star, CheckCircle2, AlertTriangle, Trash2, Search, Plus, Minus, Trash } from "lucide-react";
import type { Order, Booking } from "@/lib/supabase/types";
import type { AppSettings } from "@/lib/settings";
import { groupOrders } from "@/lib/billing/grouping";

interface FinalizeBillModalProps {
  locationId: string;
}

type PaymentMethod = "cash" | "upi";

interface CustomerInfo {
  points_balance: number;
  name: string | null;
  /** Live discount % from any active membership the customer holds. */
  membership_discount_pct?: number | null;
  active_memberships?: Array<{
    id: string;
    bound_table_ids?: string[];
    free_hours_ledger?: Record<string, number>;
    plan?: { name?: string; discount_pct?: number; free_hrs?: number } | null;
  }>;
}


type HandoverBooking = Pick<Booking, "id" | "scheduled_start" | "scheduled_end"> & {
  order: Pick<Order, "customer_name" | "customer_phone">;
};

export function FinalizeBillModal({ locationId }: FinalizeBillModalProps) {
  const finalizeOrderId = usePOSStore((s) => s.finalizeOrderId);
  if (!finalizeOrderId) return null;
  return <FinalizeBillModalInner locationId={locationId} />;
}

function FinalizeBillModalInner({ locationId }: FinalizeBillModalProps) {
  const finalizeOrderId = usePOSStore((s) => s.finalizeOrderId)!;
  const openOrders      = usePOSStore((s) => s.openOrders);
  const now             = usePOSStore((s) => s.now);
  const pointsToRedeem  = usePOSStore((s) => s.pointsToRedeem);
  const storeTablesRef  = usePOSStore((s) => s.tables);
  const setFinalizeOrderId = usePOSStore((s) => s.setFinalizeOrderId);
  const selectOrder_fn  = usePOSStore((s) => s.selectOrder);
  const setPointsToRedeem  = usePOSStore((s) => s.setPointsToRedeem);

  const isOpen        = true;
  const selectedOrder = openOrders.find((o) => o.id === finalizeOrderId) ?? null;
  const currentGroup = useMemo(() => {
    if (!finalizeOrderId || !selectedOrder) return null;
    const grouped = groupOrders(openOrders);
    return grouped.find((g) => g.orderIds.includes(finalizeOrderId)) || {
      ...selectedOrder,
      orderIds: [finalizeOrderId],
      points_redeemed_online: (selectedOrder as any).points_redeemed_online ?? 0,
    };
  }, [openOrders, finalizeOrderId, selectedOrder]);

  const qc            = useQueryClient();

  const orderId     = finalizeOrderId;
  const savedPoints = pointsToRedeem[orderId] ?? (currentGroup?.points_redeemed ?? 0);

  const [method,           setMethod]           = useState<PaymentMethod | null>(null);
  // Split-payment state — when on, cashInput + upiInput drive `payments`;
  // when off, the single `method` selection is used with the full amount.
  const [splitMode,        setSplitMode]        = useState(false);
  const [cashInput,        setCashInput]        = useState("");
  const [upiInput,         setUpiInput]         = useState("");
  const [loading,          setLoading]          = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [customerInfo,     setCustomerInfo]     = useState<CustomerInfo | null>(null);
  // True while the customer lookup is in flight. We HAVE to block Collect
  // during this window because membership_discount_pct (and points_balance)
  // come from this fetch — clicking before it lands sends a payment_total
  // that's higher than what the server computes after applying the
  // discount, and the server rejects with PAYMENT_MISMATCH.
  const [lookupPending,    setLookupPending]    = useState(false);
  const [redeemInput,      setRedeemInput]      = useState(String(savedPoints));
  const [step,             setStep]             = useState<"bill" | "handover">("bill");
  const [handoverBookings, setHandoverBookings] = useState<HandoverBooking[]>([]);
  const [handoverLoading,  setHandoverLoading]  = useState<string | null>(null);
  const [manualPhone,      setManualPhone]      = useState("");
  const [confirmCancel,    setConfirmCancel]    = useState(false);
  const [membershipIdInput, setMembershipIdInput] = useState("");
  const [validatedMemberships, setValidatedMemberships] = useState<any[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  const [selectedItemResetKey, setSelectedItemResetKey] = useState(0);

  const { data: inventoryItemsRes } = useQuery<any>({
    queryKey: ["inventory-items", locationId],
    queryFn: async () => {
      const res = await fetch(`/api/inventory?location_id=${locationId}`);
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
  });
  const inventoryItems = inventoryItemsRes ?? [];

  const handleAddExtra = async (item: any) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/extras`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventory_item_id: item.id,
          name: item.name,
          price: Number(item.selling_price),
          quantity: 1,
          source: "pos"
        })
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      toast.success(`Added ${item.name}`);
      setItemSearchQuery("");
      setSelectedItemResetKey((prev) => prev + 1);
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      qc.invalidateQueries({ queryKey: ["pos-tables", locationId] });
    } catch (e: any) {
      toast.error(e.message || "Failed to add item");
    }
  };

  const handleUpdateExtraQty = async (extraId: string, currentQty: number, change: number) => {
    const newQty = currentQty + change;
    if (newQty <= 0) {
      handleDeleteExtra(extraId);
      return;
    }
    try {
      const res = await fetch(`/api/orders/${orderId}/extras/${extraId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: newQty })
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      qc.invalidateQueries({ queryKey: ["pos-tables", locationId] });
    } catch (e: any) {
      toast.error(e.message || "Failed to update quantity");
    }
  };

  const handleDeleteExtra = async (extraId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/extras/${extraId}`, {
        method: "DELETE"
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      toast.success("Item removed");
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      qc.invalidateQueries({ queryKey: ["pos-tables", locationId] });
    } catch (e: any) {
      toast.error(e.message || "Failed to remove item");
    }
  };

  const handleAddExtension = async (orderItemId: string, mins: number) => {
    try {
      const res = await fetch("/api/sessions/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_item_id: orderItemId, extend_mins: mins }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      toast.success(`Extended session by ${mins} minutes`);
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      qc.invalidateQueries({ queryKey: ["pos-tables", locationId] });
    } catch (e: any) {
      toast.error(e.message || "Failed to extend session");
    }
  };

  const handleRemoveExtension = async (orderItemId: string) => {
    try {
      const res = await fetch("/api/sessions/remove-extension", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_item_id: orderItemId }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      toast.success("Removed session extension");
      qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
      qc.invalidateQueries({ queryKey: ["pos-tables", locationId] });
    } catch (e: any) {
      toast.error(e.message || "Failed to remove extension");
    }
  };

  const redeemPoints = Math.max(0, parseInt(redeemInput) || 0);

  const activeItems  = currentGroup?.items.filter((i) => i.status !== "cancelled" && i.status !== "scheduled" && !i.is_deleted) ?? [];
  const activeExtras = currentGroup?.extras.filter((e) => !e.is_deleted && !e.name.startsWith("[PENDING]")) ?? [];

  const allMemberships = validatedMemberships.length > 0
    ? validatedMemberships
    : (currentGroup?.membership_id && customerInfo?.active_memberships
        ? customerInfo.active_memberships.filter(m => m.id === currentGroup.membership_id)
        : []);

  const storedDiscount = (currentGroup?.discount_amount ?? 0) - ((currentGroup as any)?.public_discount_amount ?? 0);
  const fallbackPct = (currentGroup?.membership_id && currentGroup?.subtotal && Number(currentGroup.subtotal) > 0)
    ? Math.round((Number(storedDiscount) / Number(currentGroup.subtotal)) * 100)
    : 0;

  const membershipPct = allMemberships.reduce((max, m) => {
    const pct = m.plan?.discount_pct ?? 0;
    return pct > max ? pct : max;
  }, fallbackPct);

  const ledgerUpdates: Map<string, Record<string, number>> = new Map();
  allMemberships.forEach(m => {
    ledgerUpdates.set(m.id, { ...(m.free_hours_ledger || {}) });
  });

  let totalFreeHoursDiscount = 0;
  const itemDeductions: { tableName: string; hoursRedeemed: number; remainingHours: number }[] = [];

  const hasPreSavedFreeHours = activeItems.some(i => Number((i as any).free_hours_to_redeem) > 0);

  if (allMemberships.length === 0 && hasPreSavedFreeHours) {
    for (const item of activeItems) {
      const savedHrs = Number((item as any).free_hours_to_redeem) || 0;
      if (savedHrs > 0) {
        const freeHoursDiscount = savedHrs * (item.rate_per_hour || 0);
        totalFreeHoursDiscount += freeHoursDiscount;
        const storeTable = storeTablesRef.find(t => t.id === item.table_id);
        itemDeductions.push({
          tableName: storeTable?.name || item.table?.name || "Table",
          hoursRedeemed: savedHrs,
          remainingHours: 0,
        });
      }
    }
  } else {
    for (const item of activeItems) {
      const tableMeta = item.table as { id?: string; type?: string } | null;
      const tableId = item.table_id || tableMeta?.id;
      const storeTable = storeTablesRef.find(t => t.id === tableId);
      const tableType = tableMeta?.type || storeTable?.type || "";

      const itemMembershipId = (item as any).membership_id;
      const isBound = (m: any) => !m.bound_table_ids || m.bound_table_ids.length === 0 || m.bound_table_ids.includes(tableId ?? "");
      let coveringMembership = itemMembershipId
        ? allMemberships.find(m => m.id === itemMembershipId && isBound(m))
        : allMemberships.find(m => isBound(m));

      if (!coveringMembership) continue;

      const ledger = ledgerUpdates.get(coveringMembership.id);
      if (!ledger) continue;
      const remainingFreeHrs = Number(ledger[tableType]) || 0;
      if (remainingFreeHrs <= 0) continue;

      let start: Date;
      let end: Date;
      if (item.actual_start) {
        start = new Date(item.actual_start);
        end = item.expected_end
          ? new Date(item.expected_end)
          : item.actual_end
          ? new Date(item.actual_end)
          : now;
      } else if (item.scheduled_start && item.scheduled_end) {
        start = new Date(item.scheduled_start);
        end = new Date(item.scheduled_end);
      } else {
        continue;
      }

      const durationHrs = (end.getTime() - start.getTime()) / (3600 * 1000);
      // Free hours cover full duration (session + extensions) up to available ledger balance
      const maxRedeem = Math.min(durationHrs, remainingFreeHrs);

      const freeHoursDiscount = maxRedeem * (item.rate_per_hour || 0);
      totalFreeHoursDiscount += freeHoursDiscount;
      ledger[tableType] = Math.max(0, Math.round((remainingFreeHrs - maxRedeem) * 100) / 100);

      itemDeductions.push({
        tableName: storeTable?.name || item.table?.name || "Table",
        hoursRedeemed: maxRedeem,
        remainingHours: ledger[tableType],
      });
    }
  }
  // Use public_discount_amount (coupon-only portion stored at booking time).
  // Member discount is always applied live via membershipPct so it covers
  // extensions + extras added after the booking — matching the finalize route.
  const publicFixedDiscount = (currentGroup as any)?.public_discount_amount ?? currentGroup?.discount_amount ?? 0;
  const bill          = calculateBill(activeItems, activeExtras, now, null, currentGroup?.advance_paid ?? 0, publicFixedDiscount, membershipPct, totalFreeHoursDiscount);
  // fullyPrePaid: all charges are already covered by advance (online full-pay).
  // Use bill.totalDue which is already net of ALL discounts + advance.
  const fullyPrePaid  = bill.totalDue <= 0 && (currentGroup?.advance_paid ?? 0) > 0;
  const totalFreeHoursDiscountVal = bill.freeHoursDiscountAmount;
  const pctDiscount = bill.memberDiscountAmount;
  const membershipDiscount = Math.round((totalFreeHoursDiscountVal + pctDiscount) * 100) / 100;
  const billAfterMembership = bill.totalDue;



  const { data: settings } = useQuery<AppSettings>({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      const body = await res.json() as { success: boolean; data?: AppSettings };
      if (!body.success || !body.data) throw new Error("Failed to load settings");
      return body.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const earnRate          = settings?.loyalty?.earn_rupees_per_point ?? 100;
  const redeemRate        = settings?.loyalty?.redeem_rupees_per_point ?? 1;
  const minPointsToRedeem = settings?.loyalty?.min_points_to_redeem ?? 100;

  const maxPointsByBill   = Math.floor(billAfterMembership / redeemRate);
  const preExistingPoints = selectedOrder?.points_redeemed ?? 0;
  const diff = redeemPoints - preExistingPoints;
  const isQualified = (customerInfo?.points_balance ?? 0) >= minPointsToRedeem || preExistingPoints >= minPointsToRedeem;
  const allowedNewMax = isQualified ? Math.min(customerInfo?.points_balance ?? 0, Math.max(0, maxPointsByBill - preExistingPoints)) : 0;
  const maxRedeem = preExistingPoints + allowedNewMax;

  let clampedRedeem = preExistingPoints;
  if (diff > 0) {
    clampedRedeem = Math.min(redeemPoints, maxRedeem);
  } else {
    clampedRedeem = redeemPoints;
  }
  const finalDue          = Math.max(0, Math.round((billAfterMembership - (clampedRedeem * redeemRate)) * 100) / 100);
  const pointsToEarn      = Math.floor(finalDue / earnRate);

  const phoneForLookup = selectedOrder?.customer_phone ?? (manualPhone.length >= 10 ? manualPhone : null);

  useEffect(() => {
    setCustomerInfo(null);
    setValidatedMemberships([]);
    setMembershipIdInput("");
    setValidationError(null);
    if (!isOpen || !phoneForLookup) {
      setLookupPending(false);
      return;
    }
    setLookupPending(true);
    fetch(`/api/customers/lookup?phone=${encodeURIComponent(phoneForLookup)}`)
      .then((r) => r.json())
      .then((data: { found: boolean; customer: CustomerInfo | null }) => setCustomerInfo(data.customer))
      .catch(() => {})
      .finally(() => setLookupPending(false));
  }, [isOpen, phoneForLookup]);

  useEffect(() => {
    setRedeemInput(String(savedPoints));
  }, [savedPoints, isOpen]);

  function handleRedeemChange(val: string) {
    setRedeemInput(val);
    const n = Math.max(0, parseInt(val) || 0);
    if (orderId) setPointsToRedeem(orderId, Math.min(n, maxRedeem));
  }

  function close() {
    setFinalizeOrderId(null);
    setMethod(null);
    setSplitMode(false);
    setCashInput("");
    setUpiInput("");
    setError(null);
    setStep("bill");
    setHandoverBookings([]);
    setHandoverLoading(null);
    setManualPhone("");
    setValidatedMemberships([]);
    setMembershipIdInput("");
    setValidationError(null);
  }

  // Auto-balance helpers — typing in one field fills the other so the sum
  // always equals finalDue. Staff can re-enter either side; we never let
  // them go negative.
  function changeCash(val: string) {
    const cleaned = val.replace(/[^\d.]/g, "");
    setCashInput(cleaned);
    const n = parseFloat(cleaned);
    if (Number.isFinite(n)) {
      setUpiInput(String(Math.max(0, Math.round((finalDue - n) * 100) / 100)));
    }
  }
  function changeUpi(val: string) {
    const cleaned = val.replace(/[^\d.]/g, "");
    setUpiInput(cleaned);
    const n = parseFloat(cleaned);
    if (Number.isFinite(n)) {
      setCashInput(String(Math.max(0, Math.round((finalDue - n) * 100) / 100)));
    }
  }
  function enterSplit() {
    setSplitMode(true);
    setMethod(null);
    // Pre-fill 50/50 as a starting point — easy to override
    const half = Math.round((finalDue / 2) * 100) / 100;
    setCashInput(String(half));
    setUpiInput(String(Math.round((finalDue - half) * 100) / 100));
  }
  function exitSplit() {
    setSplitMode(false);
    setCashInput("");
    setUpiInput("");
  }

  async function handleEmergencyCancel() {
    if (!currentGroup) return;
    setLoading(true);
    setError(null);
    try {
      const cancelPromises = currentGroup.orderIds.map(id =>
        fetch(`/api/orders/${id}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emergency: true }),
        })
      );
      const responses = await Promise.all(cancelPromises);
      for (const res of responses) {
        const body = await res.json() as { success: boolean; error?: string };
        if (!body.success) {
          setError(cleanErrorMessage(body.error ?? "Failed to cancel order"));
          setLoading(false);
          return;
        }
      }
      toast.success("Bill and table sessions cancelled successfully");
      qc.invalidateQueries({ queryKey: ["pos-orders",   locationId] });
      qc.invalidateQueries({ queryKey: ["pos-tables",   locationId] });
      qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
      qc.invalidateQueries({ queryKey: ["pos-bills",    locationId] });
      selectOrder_fn(null);
      close();
    } catch (e: any) {
      setError(cleanErrorMessage(e.message ?? "Unexpected error during cancellation"));
    } finally {
      setLoading(false);
    }
  }

  // Sum of the split inputs — used both for validation and for the
  // mismatch indicator under the fields.
  const splitSum = (parseFloat(cashInput) || 0) + (parseFloat(upiInput) || 0);
  const splitOk  = Math.abs(splitSum - finalDue) <= 0.5;

  async function confirmPayment() {
    if (submittingRef.current || !currentGroup) return;

    let cashAmt = splitMode
      ? Math.round((parseFloat(cashInput) || 0) * 100) / 100
      : method === "cash"
      ? finalDue
      : 0;

    let upiAmt = splitMode
      ? Math.round((parseFloat(upiInput) || 0) * 100) / 100
      : method === "upi"
      ? finalDue
      : 0;

    if (finalDue > 0 && cashAmt + upiAmt === 0) return;
    if (splitMode && !splitOk) {
      setError(`Split total ₹${splitSum} must equal ₹${finalDue}`);
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const ordersToFinalize = openOrders.filter(o => currentGroup.orderIds.includes(o.id));
      let newVenuePoints = clampedRedeem - currentGroup.points_redeemed_online;

      // 1. Calculate tempDue for each individual order
      const ordersWithDue = ordersToFinalize.map(o => {
        const oItems = o.items.filter((i) => i.status !== "cancelled" && i.status !== "scheduled" && !i.is_deleted);
        const oExtras = o.extras.filter((e) => !e.is_deleted && !e.name.startsWith("[PENDING]"));
        const oPublicDiscount = (o as any).public_discount_amount ?? o.discount_amount ?? 0;
        const oFreeHrs = computeFreeHoursDiscount(oItems, allMemberships, now, storeTablesRef);
        const oMembPct = allMemberships.reduce((max, m) => {
          const pct = m.plan?.discount_pct ?? 0;
          return pct > max ? pct : max;
        }, fallbackPct);
        const oBill = calculateBill(oItems, oExtras, now, null, o.advance_paid ?? 0, oPublicDiscount, oMembPct, oFreeHrs);
        return {
          order: o,
          tempDue: oBill.totalDue,
          assignedPoints: o.points_redeemed_online ?? 0,
          assignedPayments: [] as any[],
        };
      });

      // 2. Distribute new venue points to satisfy individual order balances
      if (newVenuePoints > 0) {
        for (const item of ordersWithDue) {
          if (item.tempDue > 0) {
            const maxPointsByBill = Math.floor(item.tempDue / redeemRate);
            const pointsToAssign = Math.min(newVenuePoints, maxPointsByBill);
            item.assignedPoints += pointsToAssign;
            newVenuePoints -= pointsToAssign;
            item.tempDue = Math.max(0, item.tempDue - pointsToAssign * redeemRate);
          }
        }
      }

      // 3. Distribute Cash and UPI payments across the orders
      for (const item of ordersWithDue) {
        if (item.tempDue > 0) {
          if (cashAmt > 0) {
            const payCash = Math.min(cashAmt, item.tempDue);
            item.assignedPayments.push({ method: "cash", amount: Math.round(payCash * 100) / 100 });
            cashAmt -= payCash;
            item.tempDue -= payCash;
          }
          if (item.tempDue > 0 && upiAmt > 0) {
            const payUpi = Math.min(upiAmt, item.tempDue);
            item.assignedPayments.push({ method: "upi", amount: Math.round(payUpi * 100) / 100 });
            upiAmt -= payUpi;
            item.tempDue -= payUpi;
          }
        }
      }

      // 4. Fire parallel finalization requests
      const finalizePromises = ordersWithDue.map(item =>
        fetch(`/api/orders/${item.order.id}/finalize`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payments:        item.assignedPayments,
            points_redeemed: item.assignedPoints,
            membership_id:   validatedMemberships.length > 0 ? (validatedMemberships[0].short_id || validatedMemberships[0].id) : undefined,
            ...(manualPhone && !item.order.customer_phone ? { customer_phone: manualPhone } : {}),
          }),
        })
      );

      const responses = await Promise.all(finalizePromises);
      for (const res of responses) {
        const body = await res.json() as { success: boolean; error?: string };
        if (!body.success) {
          setError(cleanErrorMessage(body.error ?? "Failed to finalize order"));
          setLoading(false);
          submittingRef.current = false;
          return;
        }
      }

      qc.invalidateQueries({ queryKey: ["pos-orders",   locationId] });
      qc.invalidateQueries({ queryKey: ["pos-tables",   locationId] });
      qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
      qc.invalidateQueries({ queryKey: ["pos-bills",    locationId] });
      selectOrder_fn(null);
      setLoading(false);
      submittingRef.current = false;

      // Capture handovers from current table state BEFORE queries invalidate
      const finalizedTableIds = new Set(activeItems.map((i) => i.table_id));
      const handovers: HandoverBooking[] = storeTablesRef
        .filter((t) => finalizedTableIds.has(t.id) && t.upcomingBooking !== null)
        .map((t) => ({
          id:              t.upcomingBooking!.id,
          scheduled_start: t.upcomingBooking!.scheduled_start,
          scheduled_end:   t.upcomingBooking!.scheduled_end,
          order:           t.upcomingBooking!.order,
        }));

      if (handovers.length > 0) {
        setHandoverBookings(handovers);
        setStep("handover");
      } else {
        close();
      }
    } catch (err: any) {
      setError(cleanErrorMessage(err.message || "A network error occurred. Please try again."));
      setLoading(false);
      submittingRef.current = false;
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
      selectOrder_fn(body.data.order_id);
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
                        {new Date(booking.scheduled_start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                        {" → "}
                        {new Date(booking.scheduled_end).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
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
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden bg-white dark:bg-[#111] border border-gray-200 dark:border-[#2A2A2A]">
        <DialogHeader className="px-6 pt-6 pb-4.5 border-b border-gray-200 dark:border-[#1F1F1F]">
          <DialogTitle className="text-gray-900 dark:text-white text-xl font-black">Finalize Bill</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5 max-h-[80vh] overflow-y-auto">

          {/* Bill breakdown */}
          <div className="rounded-xl p-5 space-y-3.5 text-base bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#1F1F1F]">
            {fullyPrePaid ? (
              <>
                <div className="flex justify-between text-sm font-black" style={{ color: "#10b981" }}>
                  <span>Session pre-paid online</span><span>✓ covered</span>
                </div>
                {bill.tableLines.filter((l) => l.overtimeMins > 0).map((line) => {
                  const ti = activeItems.find((i) => i.id === line.id);
                  const tn = (ti?.table as { name?: string } | null)?.name ?? "Table";
                  const formatDuration = (mins: number) => {
                    const h = Math.floor(mins / 60);
                    const m = mins % 60;
                    return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
                  };
                  return (
                    <div key={line.id} className="flex justify-between text-base font-extrabold text-left">
                      <span className="text-gray-700 dark:text-[#ccc]">{tn} — overtime {formatDuration(line.overtimeMins)}</span>
                      <span className="text-gray-900 dark:text-white font-black">{formatCurrency(line.overtimeAmount)}</span>
                    </div>
                  );
                })}
              </>
            ) : (
              bill.tableLines.map((line) => {
                const ti = activeItems.find((i) => i.id === line.id);
                const tableMeta = ti?.table as { name?: string; type?: string } | null;
                const tn = tableMeta?.name ?? "Table";
                const peopleLabel = ti?.num_people
                  ? ` · ${ti.num_people} ${tableMeta?.type === "ps5"
                      ? `controller${ti.num_people === 1 ? "" : "s"}`
                      : `player${ti.num_people === 1 ? "" : "s"}`}`
                  : "";
                const formatDuration = (mins: number) => {
                  const h = Math.floor(mins / 60);
                  const m = mins % 60;
                  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
                };

                const baseMins = ti?.scheduled_duration_mins || 60;
                const extMins = ti?.extended_mins || 0;

                return (
                  <div key={line.id} className="space-y-1 py-1">
                    <div className="flex justify-between text-base font-extrabold text-left">
                      <span className="text-gray-700 dark:text-[#ccc]">{tn} (Original {formatDuration(baseMins)}{peopleLabel})</span>
                      <span className="text-gray-900 dark:text-white font-black">{formatCurrency((baseMins / 60) * (ti?.rate_per_hour || 0))}</span>
                    </div>
                    {extMins > 0 && (
                      <div className="pl-4 flex items-center justify-between text-sm font-extrabold text-amber-600 dark:text-amber-400">
                        <span className="flex items-center gap-1.5">
                          <span>Extension (+{formatDuration(extMins)})</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveExtension(ti!.id)}
                            className="text-red-500 hover:text-red-700 transition-colors p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20"
                            title="Remove Extension"
                          >
                            <Trash className="h-3.5 w-3.5" />
                          </button>
                        </span>
                        <span className="font-mono">{formatCurrency((extMins / 60) * (ti?.rate_per_hour || 0))}</span>
                      </div>
                    )}
                    {ti && (ti.status === "finished" || ti.status === "running") && (
                      <div className="pl-4 flex items-center gap-2 mt-1 py-0.5">
                        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Add extension:</span>
                        <button
                          type="button"
                          onClick={() => handleAddExtension(ti.id, 30)}
                          className="text-[10px] font-black px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-[#ccc] transition-all"
                        >
                          +30m
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddExtension(ti.id, 60)}
                          className="text-[10px] font-black px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-[#ccc] transition-all"
                        >
                          +1h
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddExtension(ti.id, 120)}
                          className="text-[10px] font-black px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-[#ccc] transition-all"
                        >
                          +2h
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {bill.extraLines.map((line) => (
              <div key={line.id} className="flex justify-between text-base font-extrabold">
                <span className="text-gray-700 dark:text-[#ccc]">{line.name} ×{line.quantity}</span>
                <span className="text-gray-900 dark:text-white font-black">{formatCurrency(line.amount)}</span>
              </div>
            ))}

            {!fullyPrePaid && (
              <div className="flex justify-between pt-2.5 border-t border-gray-200 dark:border-[#2A2A2A] text-base font-black">
                <span className="text-gray-800 dark:text-[#ccc]">Subtotal</span>
                <span className="text-gray-900 dark:text-white text-lg">{formatCurrency(bill.subtotal)}</span>
              </div>
            )}

            {bill.discountAmount > 0 && (
              <div className="flex justify-between text-base font-black">
                <span style={{ color: "#10b981" }}>Public Discount</span>
                <span style={{ color: "#10b981" }}>−{formatCurrency(bill.discountAmount)}</span>
              </div>
            )}
            {!fullyPrePaid && bill.advancePaid > 0 && (
              <div className="flex justify-between text-base font-black">
                <span style={{ color: "#10b981" }}>Advance paid</span>
                <span style={{ color: "#10b981" }}>−{formatCurrency(bill.advancePaid)}</span>
              </div>
            )}
            {totalFreeHoursDiscount > 0 && (
              <div className="space-y-1 text-base font-black">
                <div className="flex justify-between">
                  <span style={{ color: "#8b5cf6" }}>Membership Discount (Free Hours)</span>
                  <span style={{ color: "#8b5cf6" }}>−{formatCurrency(totalFreeHoursDiscount)}</span>
                </div>
                <div className="pl-3 border-l-2 py-0.5 space-y-0.5" style={{ borderColor: "#8b5cf6" }}>
                  {itemDeductions.map((d, idx) => (
                    <p key={idx} className="text-sm font-extrabold text-purple-600 dark:text-purple-400">
                      Redeemed {d.hoursRedeemed} {d.hoursRedeemed === 1 ? 'hr' : 'hrs'} for {d.tableName} ({d.remainingHours} hrs remaining)
                    </p>
                  ))}
                </div>
              </div>
            )}
            {pctDiscount > 0 && (
              <div className="flex justify-between text-base font-black">
                <span style={{ color: "#8b5cf6" }}>Membership Discount ({membershipPct}% off)</span>
                <span style={{ color: "#8b5cf6" }}>−{formatCurrency(pctDiscount)}</span>
              </div>
            )}

            {currentGroup?.points_redeemed_online > 0 && (
              <div className="flex justify-between text-base font-black">
                <span style={{ color: "#f59e0b" }}>Points Redeemed (Online)</span>
                <span style={{ color: "#f59e0b" }}>−{formatCurrency((currentGroup?.points_redeemed_online ?? 0) * redeemRate)}</span>
              </div>
            )}
            {clampedRedeem - (currentGroup?.points_redeemed_online ?? 0) > 0 && (
              <div className="flex justify-between text-base font-black">
                <span style={{ color: "#f59e0b" }}>Points Redeemed (At Venue)</span>
                <span style={{ color: "#f59e0b" }}>−{formatCurrency((clampedRedeem - (currentGroup?.points_redeemed_online ?? 0)) * redeemRate)}</span>
              </div>
            )}

            <div className="flex justify-between text-xl font-black pt-3 border-t border-gray-200 dark:border-[#2A2A2A]">
              <span className="text-gray-900 dark:text-white">Total Due</span>
              <span className="text-3xl font-black" style={{ color: "#D4541A" }}>{formatCurrency(finalDue)}</span>
            </div>
          </div>

          {/* Manage Extras / Snacks */}
          <div className="rounded-xl p-5 space-y-4 bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#1F1F1F] text-left">
            <h3 className="text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
              Add Items / Snacks
            </h3>

            {/* Dropdown Catalog Select */}
            <Select
              key={selectedItemResetKey}
              value=""
              onValueChange={(val) => {
                const item = inventoryItems.find((i: any) => i.id === val);
                if (item) {
                  handleAddExtra(item);
                }
              }}
            >
              <SelectTrigger className="h-12 text-sm px-4 rounded-xl font-bold bg-white dark:bg-[#181818] border-gray-200 dark:border-gray-800">
                <SelectValue placeholder="Choose inventory item to add..." />
              </SelectTrigger>
              <SelectContent className="bg-white dark:bg-[#111] border dark:border-[#222]">
                {inventoryItems
                  .filter((item: any) => item.is_active && item.stock_count > 0)
                  .map((item: any) => (
                    <SelectItem key={item.id} value={item.id} className="text-sm font-semibold">
                      {item.name} (₹{item.selling_price})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            {/* List of currently added extras */}
            {activeExtras.length > 0 ? (
              <div className="space-y-2">
                {activeExtras.map((e) => {
                  const unitPrice = Number(e.price) || 0;
                  return (
                    <div key={e.id} className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-[#111] border border-gray-200 dark:border-[#2A2A2A] shadow-sm animate-fade-in">
                      <div className="min-w-0 flex-1 pr-3 text-left">
                        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{e.name}</p>
                        <p className="text-xs font-semibold text-gray-450 font-mono mt-0.5">₹{unitPrice} each</p>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Minus */}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => handleUpdateExtraQty(e.id, e.quantity, -1)}
                          className="h-8 w-8 p-0 rounded-md border-gray-200 dark:border-gray-800"
                        >
                          <Minus className="h-3 w-3" />
                        </Button>

                        <span className="w-8 text-center text-sm font-black text-gray-950 dark:text-white font-mono">
                          {e.quantity}
                        </span>

                        {/* Plus */}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => handleUpdateExtraQty(e.id, e.quantity, 1)}
                          className="h-8 w-8 p-0 rounded-md border-gray-200 dark:border-gray-800"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>

                        {/* Delete */}
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => handleDeleteExtra(e.id)}
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-750 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-md ml-1"
                        >
                          <Trash className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-405 dark:text-[#555] font-semibold text-center py-2">No extra items added to this tab</p>
            )}
          </div>
          {/* Membership validation section */}
          {customerInfo && customerInfo.active_memberships && customerInfo.active_memberships.length > 0 && (
            <div className="rounded-xl p-4 space-y-2.5 bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#1F1F1F]">
              <div className="flex items-center gap-2">
                <Star className="h-3.5 w-3.5" style={{ color: "#8b5cf6" }} />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">Membership Details</span>
              </div>

              {allMemberships.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-green-600 dark:text-green-400">
                      Membership Applied ({allMemberships[0].short_id}) ✓
                    </span>
                    {!selectedOrder?.membership_id && (
                      <button
                        type="button"
                        onClick={() => {
                          setValidatedMemberships([]);
                          setMembershipIdInput("");
                        }}
                        className="text-xs font-semibold text-red-500 hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {allMemberships.map((vm) => (
                      <p key={vm.id} className="text-xs text-gray-500 dark:text-[#888]">
                        Plan: {vm.plan?.name} {vm.plan?.discount_pct > 0 ? `(${vm.plan.discount_pct}% Off)` : ""}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">
                    Active plans detected on this number. Enter Membership ID to unlock benefits.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Enter Membership ID"
                      value={membershipIdInput}
                      onChange={(e) => {
                        setMembershipIdInput(e.target.value);
                        setValidationError(null);
                      }}
                      className="flex-1 text-sm rounded-lg px-2.5 py-1 outline-none transition-all uppercase tracking-wider
                        bg-gray-100 dark:bg-[#1A1A1A]
                        border border-gray-200 dark:border-[#2A2A2A]
                        text-gray-900 dark:text-white
                        focus:border-[#8b5cf6]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const input = membershipIdInput.trim().toUpperCase();
                        const active_memberships = customerInfo.active_memberships || [];
                        const matched = active_memberships.some((m: any) => {
                          const target = (m.short_id || "").trim().toUpperCase();
                          return input && target && input === target;
                        });
                        if (matched) {
                          setValidatedMemberships(active_memberships);
                          setValidationError(null);
                        } else {
                          setValidationError("Incorrect Membership ID");
                        }
                      }}
                      className="px-3 py-1 rounded-lg font-bold text-xs bg-purple-600 hover:bg-purple-700 text-white shadow transition-all"
                    >
                      Validate
                    </button>
                  </div>
                  {validationError && (
                    <p className="text-[10px] font-semibold text-red-500">{validationError}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Loyalty points */}
          <div className="rounded-xl p-5 space-y-3.5 bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#1F1F1F]">
            <div className="flex items-center gap-2">
              <Star className="h-5 w-5" style={{ color: "#f59e0b" }} />
              <span className="text-base font-black text-gray-900 dark:text-white">Loyalty Points</span>
            </div>

            {/* Phone entry when walk-in had no phone */}
            {!selectedOrder?.customer_phone && (
              <input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={10}
                placeholder="10-digit phone"
                value={manualPhone}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/\D/g, "").slice(0, 10);
                  setManualPhone(cleaned);
                  setCustomerInfo(null);
                }}
                className="w-full text-base rounded-xl px-4.5 py-3 outline-none transition-colors
                  bg-gray-100 dark:bg-[#1A1A1A]
                  border border-gray-200 dark:border-[#2A2A2A]
                  text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#444]
                  focus:border-[#f59e0b]"
              />
            )}

            {phoneForLookup && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-extrabold text-gray-500 dark:text-[#888]">Balance</span>
                <span className="text-base font-black" style={{ color: "#f59e0b" }}>
                  {customerInfo ? `${customerInfo.points_balance} pts` : "Looking up…"}
                </span>
              </div>
            )}

            {customerInfo && customerInfo.points_balance >= minPointsToRedeem && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-extrabold text-gray-500 dark:text-[#888] shrink-0">Redeem</span>
                  <input
                    type="number"
                    min="0"
                    max={maxRedeem}
                    value={redeemInput}
                    onChange={(e) => handleRedeemChange(e.target.value)}
                    className="w-24 text-base font-black rounded-xl px-3 py-2 outline-none transition-colors
                      bg-gray-100 dark:bg-[#1A1A1A]
                      border border-gray-200 dark:border-[#2A2A2A]
                      text-gray-900 dark:text-white
                      focus:border-[#f59e0b]"
                  />
                  <span className="text-sm font-extrabold text-gray-500 dark:text-[#888]">/ {maxRedeem} max</span>
                </div>
                <p className="text-xs font-bold text-gray-500 dark:text-[#777]">
                  Requires min. balance of {minPointsToRedeem} pts to redeem.
                </p>
              </div>
            )}

            <p className="text-sm font-black text-gray-600 dark:text-[#ccc]">
              Will earn{" "}
              <span className="font-black" style={{ color: "#f59e0b" }}>{pointsToEarn} pts</span>{" "}
              from this visit
            </p>
          </div>

          {/* Payment method — single or split */}
          {finalDue > 0 ? (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-[#444]">
                  Payment method
                </p>
                <button
                  type="button"
                  onClick={splitMode ? exitSplit : enterSplit}
                  className="text-[11px] font-bold text-[#D4541A] hover:opacity-80"
                >
                  {splitMode ? "← Single method" : "Split between Cash + UPI"}
                </button>
              </div>

              {!splitMode ? (
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
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl p-3 bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#2A2A2A]">
                      <div className="flex items-center gap-1.5 mb-1.5 text-gray-500 dark:text-[#888]">
                        <Banknote className="h-3.5 w-3.5" />
                        <span className="text-[10px] font-bold uppercase tracking-wide">Cash</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-xs text-gray-500 dark:text-[#888]">₹</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={cashInput}
                          onChange={(e) => changeCash(e.target.value)}
                          placeholder="0"
                          className="w-full bg-transparent outline-none text-lg font-bold tabular-nums text-gray-900 dark:text-white"
                        />
                      </div>
                    </div>
                    <div className="rounded-xl p-3 bg-gray-50 dark:bg-[#161616] border border-gray-200 dark:border-[#2A2A2A]">
                      <div className="flex items-center gap-1.5 mb-1.5 text-gray-500 dark:text-[#888]">
                        <Smartphone className="h-3.5 w-3.5" />
                        <span className="text-[10px] font-bold uppercase tracking-wide">UPI</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-xs text-gray-500 dark:text-[#888]">₹</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={upiInput}
                          onChange={(e) => changeUpi(e.target.value)}
                          placeholder="0"
                          className="w-full bg-transparent outline-none text-lg font-bold tabular-nums text-gray-900 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>
                  <p
                    className="text-[11px] font-semibold text-right tabular-nums"
                    style={{ color: splitOk ? "#10b981" : "#ef4444" }}
                  >
                    Split sum: {formatCurrency(splitSum)} / {formatCurrency(finalDue)}
                    {!splitOk && ` (off by ${formatCurrency(Math.abs(splitSum - finalDue))})`}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl p-3.5 text-center bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-400 font-medium text-xs">
              ✓ Fully covered. No outstanding balance due.
            </div>
          )}

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
            disabled={loading || lookupPending || (finalDue > 0 ? (splitMode ? !splitOk : !method) : false)}
            className="w-full py-4.5 rounded-2xl font-black text-lg text-white transition-opacity hover:opacity-90 disabled:opacity-30"
            style={{ background: "#D4541A" }}
          >
            {loading
              ? "Processing..."
              : lookupPending
              ? "Loading customer…"
              : finalDue === 0
              ? "Finalize Bill"
              : `Collect ${formatCurrency(finalDue)}`}
          </button>

          <div className="pt-2 border-t border-gray-100 dark:border-[#1A1A1A]">
            {!confirmCancel ? (
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                disabled={loading}
                className="w-full py-2 flex items-center justify-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Cancel Bill / Emergency Release
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 space-y-2">
                <div className="flex items-center gap-1.5 text-rose-700 dark:text-rose-300 font-bold text-xs">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Confirm Emergency Cancellation?</span>
                </div>
                <p className="text-[11px] text-rose-600 dark:text-rose-400 leading-snug">
                  This will cancel the order, release the table slots back to available state, and restore any redeemed points.
                </p>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleEmergencyCancel}
                    disabled={loading}
                    className="flex-1 py-1.5 rounded-lg bg-rose-600 text-white font-bold text-xs hover:bg-rose-700 transition-colors disabled:opacity-40"
                  >
                    {loading ? "Cancelling…" : "Yes, Cancel Order"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(false)}
                    disabled={loading}
                    className="px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-[#2A2A2A] text-gray-700 dark:text-gray-200 font-semibold text-xs hover:opacity-80 transition-colors"
                  >
                    No, keep bill
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
