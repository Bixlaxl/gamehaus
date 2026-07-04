"use client";

import { useState, useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { BarChart2, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const supabase = createClient();

type Preset = "7d" | "30d" | "thisMonth" | "lastMonth" | "custom";

function presetDates(preset: Preset): { from: string; to: string } {
  const today = new Date();
  const pad = (d: Date) => d.toISOString().split("T")[0];
  if (preset === "7d") {
    return { from: pad(new Date(Date.now() - 6 * 86400000)), to: pad(today) };
  }
  if (preset === "30d") {
    return { from: pad(new Date(Date.now() - 29 * 86400000)), to: pad(today) };
  }
  if (preset === "thisMonth") {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: pad(s), to: pad(today) };
  }
  if (preset === "lastMonth") {
    const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const e = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: pad(s), to: pad(e) };
  }
  return { from: pad(new Date(Date.now() - 29 * 86400000)), to: pad(today) };
}

const PRESETS: { label: string; value: Preset }[] = [
  { label: "Last 7 days",  value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "This month",   value: "thisMonth" },
  { label: "Last month",   value: "lastMonth" },
  { label: "Custom",       value: "custom" },
];

const METHOD_LABELS: Record<string, string> = {
  cash:     "Cash",
  upi:      "UPI",
  razorpay: "Online (Razorpay)",
};

type ReportOrder = {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  amount_due: number | null;
  advance_paid: number | null;
  subtotal?: number | null;
  discount_amount?: number | null;
  public_discount_amount?: number | null;
  total_amount?: number | null;
  points_redeemed?: number | null;
  type: string;
  finalized_at: string | null;
  location: { id: string; name: string } | null;
  items: Array<{ status: string; rate_per_hour: number; actual_start: string | null; expected_end: string | null; final_amount?: number | null; free_hours_to_redeem?: number | null }>;
  payments: Array<{ method: string; amount: number; status: string }>;
  extras: Array<{ price: number; cost_price: number; quantity: number; is_deleted: boolean }>;
};

type ReportLocation = {
  id: string;
  name: string;
  opening_time: string;
  closing_time: string;
};

type ReportMembership = {
  id: string;
  customer_phone: string;
  starts_at: string;
  created_at: string;
  plan: { id: string; name: string; price: number } | null;
};

type ReportHistoryOrder = Pick<ReportOrder, "id" | "amount_due" | "advance_paid" | "finalized_at"> & {
  location_id?: string | null;
  location: { id: string; name: string } | null;
};

export function ReportsContent({
  initialReportData,
  initialFrom,
  initialTo,
}: {
  initialReportData: {
    orders: ReportOrder[];
    locations: ReportLocation[];
    history?: ReportHistoryOrder[];
    memberships?: ReportMembership[];
  };
  initialFrom: string;
  initialTo: string;
}) {
  const [preset, setPreset]                 = useState<Preset>("30d");
  const [from, setFrom]                     = useState(initialFrom);
  const [to, setTo]                         = useState(initialTo);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") {
      const { from: f, to: t } = presetDates(p);
      setFrom(f);
      setTo(t);
    }
  }

  const { data: reportData, isLoading } = useQuery<{
    orders: ReportOrder[];
    locations: ReportLocation[];
    history: ReportHistoryOrder[];
    memberships?: ReportMembership[];
  }>({
    queryKey: ["reports", from, to],
    queryFn: async () => {
      const res = await fetch(`/api/owner/reports?from=${from}&to=${to}`);
      if (!res.ok) throw new Error("Failed to fetch reports");
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Failed to fetch reports");
      return json.data;
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const orders    = reportData?.orders    ?? [];
  const locations = reportData?.locations ?? [];
  const memberships = reportData?.memberships ?? [];
  const monthlyHistory = reportData?.history ?? [];
  const isHistoryLoading = isLoading;

  const monthlyData = useMemo(() => {
    if (!monthlyHistory) return [];
    
    const list: { monthKey: string; label: string; revenue: number; ordersCount: number; MoM: number }[] = [];
    const today = new Date();
    
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
      list.push({ monthKey, label, revenue: 0, ordersCount: 0, MoM: 0 });
    }
    
    const historicalOrders = selectedLocationId
      ? monthlyHistory.filter(o => o.location?.id === selectedLocationId)
      : monthlyHistory;
      
    for (const order of historicalOrders) {
      if (!order.finalized_at) continue;
      const istMs = new Date(order.finalized_at).getTime() + 5.5 * 60 * 60 * 1000;
      const istDate = new Date(istMs);
      const mKey = `${istDate.getUTCFullYear()}-${String(istDate.getUTCMonth() + 1).padStart(2, "0")}`;
      
      const bucket = list.find(b => b.monthKey === mKey);
      if (bucket) {
        const orderRev = (order.amount_due ?? 0) + (order.advance_paid ?? 0);
        bucket.revenue += orderRev;
        bucket.ordersCount += 1;
      }
    }

    // Add upfront membership sales to the history chart if in global "All Locations" view
    if (!selectedLocationId) {
      for (const m of memberships) {
        if (!m.created_at || !m.plan?.price) continue;
        const istMs = new Date(m.created_at).getTime() + 5.5 * 60 * 60 * 1000;
        const istDate = new Date(istMs);
        const mKey = `${istDate.getUTCFullYear()}-${String(istDate.getUTCMonth() + 1).padStart(2, "0")}`;

        const bucket = list.find(b => b.monthKey === mKey);
        if (bucket) {
          bucket.revenue += m.plan.price;
        }
      }
    }
    
    for (let i = 0; i < list.length; i++) {
      if (i === 0) {
        list[i].MoM = 0;
      } else {
        const prev = list[i - 1].revenue;
        const curr = list[i].revenue;
        list[i].MoM = prev > 0 ? Math.round(((curr - prev) / prev) * 100) : curr > 0 ? 100 : 0;
      }
    }
    
    return list;
  }, [monthlyHistory, memberships, selectedLocationId]);

  const filteredOrders = useMemo(
    () => selectedLocationId
      ? orders.filter((o) => o.location?.id === selectedLocationId)
      : orders,
    [orders, selectedLocationId]
  );

  const filteredMemberships = useMemo(() => {
    if (selectedLocationId) return [];
    return memberships.filter((m) => {
      if (!m.created_at) return false;
      const dateStr = m.created_at.split("T")[0];
      return dateStr >= from && dateStr <= to;
    });
  }, [memberships, selectedLocationId, from, to]);

  // Single pass over filteredOrders for all derived stats — avoids 5+ separate loops on every render
  const stats = useMemo(() => {
    const revByLoc = new Map<string, { name: string; revenue: number; sessionCount: number; orderCount: number }>();
    for (const loc of locations) {
      revByLoc.set(loc.id, { name: loc.name, revenue: 0, sessionCount: 0, orderCount: 0 });
    }
    const methodMap   = new Map<string, number>();
    const customerMap = new Map<string, { name: string; visits: number; spent: number }>();
    let tableRevenue    = 0;
    let inventoryProfit = 0;
    let totalRevenue    = 0;
    let totalSessions   = 0;

    let grossSubtotal     = 0;
    let totalCoupons      = 0;
    let totalMemberships  = 0;
    let totalPoints       = 0;
    let totalFreeHours    = 0;
    let totalCostOfExtras = 0;

    // Sum up upfront membership sales
    let totalMembershipSales = 0;
    for (const m of filteredMemberships) {
      totalMembershipSales += m.plan?.price ?? 0;
    }

    for (const o of filteredOrders) {
      const orderRev = (o.amount_due ?? 0) + (o.advance_paid ?? 0);
      totalRevenue += orderRev;

      // Seed location map from order data if the location wasn't in the initial locations list
      if (o.location?.id && !revByLoc.has(o.location.id)) {
        revByLoc.set(o.location.id, { name: o.location.name, revenue: 0, sessionCount: 0, orderCount: 0 });
      }
      const locRow = o.location?.id ? revByLoc.get(o.location.id) : undefined;
      if (locRow) {
        locRow.revenue    += orderRev;
        locRow.orderCount += 1;
      }

      // Profit: tables = 100% margin, extras = price - cost
      let rawTableVal = 0;
      let freeHoursDiscount = 0;
      if (o.items && o.items.length > 0) {
        for (const i of o.items) {
          if (i.status !== "finished") continue;
          totalSessions += 1;
          if (locRow) {
            locRow.sessionCount += 1;
          }

          let itemVal = 0;
          if (i.final_amount !== null && i.final_amount !== undefined) {
            itemVal = i.final_amount;
          } else if (i.actual_start && i.expected_end) {
            const mins = (new Date(i.expected_end).getTime() - new Date(i.actual_start).getTime()) / 60000;
            itemVal = (i.rate_per_hour / 60) * mins;
          }
          rawTableVal += itemVal;
          freeHoursDiscount += (i.free_hours_to_redeem ?? 0) * i.rate_per_hour;
        }
      } else {
        // If it's a historical imported order (or has no explicit table sessions), count it as 1 session
        totalSessions += 1;
        if (locRow) {
          locRow.sessionCount += 1;
        }
        // Fall back to setting the table value as the order's subtotal or computed total
        rawTableVal = Number(o.subtotal) || ((o.amount_due ?? 0) + (o.advance_paid ?? 0) + (o.discount_amount ?? 0));
      }

      let rawExtraVal = 0;
      let costOfExtras = 0;
      for (const e of o.extras ?? []) {
        if (e.is_deleted) continue;
        rawExtraVal  += e.price * e.quantity;
        costOfExtras += e.cost_price * e.quantity;
      }

      grossSubtotal += (rawTableVal + rawExtraVal);
      totalCostOfExtras += costOfExtras;

      // Tracing discounts
      const couponDiscount = o.public_discount_amount ?? 0;
      const totalMembershipDiscount = Math.max(0, (o.discount_amount ?? 0) - couponDiscount);
      const memberDiscountAmount = Math.max(0, totalMembershipDiscount - freeHoursDiscount);
      const remainingTables = Math.max(0, rawTableVal - freeHoursDiscount - couponDiscount);
      const memberDiscountableBase = remainingTables + rawExtraVal;

      let memberDiscountOnExtras = 0;
      let memberDiscountOnTables = 0;
      if (memberDiscountableBase > 0 && memberDiscountAmount > 0) {
        const pct = memberDiscountAmount / memberDiscountableBase;
        memberDiscountOnExtras = rawExtraVal * pct;
        memberDiscountOnTables = remainingTables * pct;
      }

      const netTablesBeforePoints = Math.max(0, remainingTables - memberDiscountOnTables);
      const netExtrasBeforePoints = Math.max(0, rawExtraVal - memberDiscountOnExtras);

      const netOrderRev = (o.amount_due ?? 0) + (o.advance_paid ?? 0);
      const orderTotalAmount = o.total_amount ?? Math.max(0, (o.subtotal ?? (rawTableVal + rawExtraVal)) - (o.discount_amount ?? 0));
      const pointsDiscount = Math.max(0, orderTotalAmount - netOrderRev);

      totalCoupons += couponDiscount;
      totalMemberships += memberDiscountAmount;
      totalPoints += pointsDiscount;
      totalFreeHours += freeHoursDiscount;

      const sumBeforePoints = netTablesBeforePoints + netExtrasBeforePoints;
      let netTables = 0;
      let netExtras = 0;

      if (sumBeforePoints > 0) {
        netTables = Math.max(0, netTablesBeforePoints - pointsDiscount * (netTablesBeforePoints / sumBeforePoints));
        netExtras = Math.max(0, netExtrasBeforePoints - pointsDiscount * (netExtrasBeforePoints / sumBeforePoints));
      } else {
        netTables = netOrderRev;
      }

      tableRevenue += netTables;
      inventoryProfit += Math.max(0, netExtras - costOfExtras);

      // Payment methods
      const orderPayments = [...o.payments];
      const hasRazorpayAdvance = orderPayments.some(
        (p) => p.method === "razorpay" && p.status === "completed" && Math.abs(p.amount - (o.advance_paid ?? 0)) < 1
      );
      if ((o.advance_paid ?? 0) > 0 && !hasRazorpayAdvance) {
        orderPayments.push({
          method: "razorpay",
          amount: o.advance_paid!,
          status: "completed",
        });
      }

      for (const p of orderPayments) {
        if (p.status !== "completed") continue;
        methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + (p.amount ?? 0));
      }

      // Top customers
      if (o.customer_phone) {
        const existing = customerMap.get(o.customer_phone) ?? { name: o.customer_name, visits: 0, spent: 0 };
        customerMap.set(o.customer_phone, {
          name:   existing.name,
          visits: existing.visits + 1,
          spent:  existing.spent + (o.amount_due ?? 0) + (o.advance_paid ?? 0),
        });
      }
    }

    const revenueByLocation = [...revByLoc.values()];
    const adjustedTotalRevenue = totalRevenue + totalMembershipSales;
    const totalProfit       = tableRevenue + inventoryProfit + totalMembershipSales;
    const marginPct         = adjustedTotalRevenue > 0 ? Math.round((totalProfit / adjustedTotalRevenue) * 100) : 0;
    const paymentBreakdown  = [...methodMap.entries()]
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount);
    const topCustomers      = [...customerMap.entries()]
      .map(([phone, data]) => ({ phone, ...data }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 10);

    return {
      revenueByLocation,
      totalRevenue: adjustedTotalRevenue,
      totalSessions,
      tableRevenue,
      inventoryProfit,
      totalProfit,
      marginPct,
      paymentBreakdown,
      topCustomers,
      grossSubtotal,
      totalCoupons,
      totalMemberships,
      totalPoints,
      totalFreeHours,
      totalCostOfExtras,
      totalMembershipSales,
    };
  }, [filteredOrders, filteredMemberships, locations]);

  const {
    revenueByLocation, totalRevenue, totalSessions,
    tableRevenue, inventoryProfit, totalProfit, marginPct,
    paymentBreakdown, topCustomers,
    grossSubtotal,
    totalCoupons,
    totalMemberships,
    totalPoints,
    totalFreeHours,
    totalCostOfExtras,
    totalMembershipSales,
  } = stats;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Reports</h1>

      {/* Preset + date range */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant={preset === p.value ? "default" : "outline"}
              onClick={() => applyPreset(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-sm text-gray-500 whitespace-nowrap">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-gray-500 whitespace-nowrap">To</Label>
              <Input type="date" value={to}   onChange={(e) => setTo(e.target.value)}   className="w-36" />
            </div>
          </div>
        )}
      </div>

      {/* Location tabs */}
      {locations.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSelectedLocationId(null)}
            className="px-4 py-1.5 rounded-full text-xs font-bold transition-colors"
            style={
              selectedLocationId === null
                ? { background: "#D4541A", color: "#fff" }
                : { background: "#f3f4f6", color: "#6b7280" }
            }
          >
            All Locations
          </button>
          {locations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => setSelectedLocationId(loc.id)}
              className="px-4 py-1.5 rounded-full text-xs font-bold transition-colors"
              style={
                selectedLocationId === loc.id
                  ? { background: "#D4541A", color: "#fff" }
                  : { background: "#f3f4f6", color: "#6b7280" }
              }
            >
              {loc.name}
            </button>
          ))}
        </div>
      )}

      {isLoading && <p className="text-gray-500">Loading...</p>}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Total Revenue</p>
          <p className="text-3xl font-bold mt-2 tabular-nums">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Gross Profit</p>
          <p className="text-3xl font-bold mt-2 tabular-nums" style={{ color: "#10b981" }}>
            {formatCurrency(totalProfit)}
          </p>
          <p className="text-xs text-gray-400 mt-1">{marginPct}% margin</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Total Orders</p>
          <p className="text-3xl font-bold mt-2 tabular-nums">{filteredOrders.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Total Sessions</p>
          <p className="text-3xl font-bold mt-2 tabular-nums">{totalSessions}</p>
        </div>
      </div>

      {/* Two-column: by location + payment breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* By location */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-gray-500" />
            <h2 className="font-semibold text-gray-900">Revenue by Location</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Location</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Revenue</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Orders</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Sessions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {revenueByLocation.map((row) => (
                <tr key={row.name}>
                  <td className="px-4 py-3 font-medium text-gray-900">{row.name}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(row.revenue)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{row.orderCount}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{row.sessionCount}</td>
                </tr>
              ))}
              {revenueByLocation.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-400 text-xs">No data</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Payment method breakdown */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Payment Methods</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {paymentBreakdown.length === 0 ? (
              <p className="px-5 py-6 text-xs text-gray-400 text-center">No payment data</p>
            ) : (
              paymentBreakdown.map(({ method, amount }) => {
                // % relative to total payments only — membership sales have no payment method entry
                const totalPayments = paymentBreakdown.reduce((s, p) => s + p.amount, 0);
                const pct = totalPayments > 0 ? Math.round((amount / totalPayments) * 100) : 0;
                return (
                  <div key={method} className="px-5 py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-900">
                          {METHOD_LABELS[method] ?? method}
                        </span>
                        <span className="text-sm font-bold text-gray-900 tabular-nums">
                          {formatCurrency(amount)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: "#D4541A" }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 tabular-nums w-8 text-right shrink-0">{pct}%</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Profit & Deductions Breakdowns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Profit breakdown */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col justify-between">
          <div>
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Profit Breakdown</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {[
                { label: "Table Sessions", profit: tableRevenue, note: "100% margin (no cost)" },
                { label: "Inventory Sales", profit: inventoryProfit, note: "selling − cost price" },
                ...(totalMembershipSales > 0
                  ? [{ label: "Membership Plan Sales", profit: totalMembershipSales, note: "100% margin (upfront)" }]
                  : []),
              ].map(({ label, profit, note }) => {
                const pct = totalProfit > 0 ? Math.round((profit / totalProfit) * 100) : 0;
                return (
                  <div key={label} className="px-5 py-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <span className="text-sm font-medium text-gray-900">{label}</span>
                          <span className="text-xs text-gray-400 ml-2">{note}</span>
                        </div>
                        <span className="text-sm font-bold tabular-nums" style={{ color: "#10b981" }}>
                          {formatCurrency(profit)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: "#10b981" }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 tabular-nums w-8 text-right shrink-0">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="bg-gray-50/50 px-5 py-4 border-t border-gray-100 flex justify-between items-center">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Gross Profit</span>
            <span className="text-base font-bold text-emerald-600 tabular-nums">{formatCurrency(totalProfit)}</span>
          </div>
        </div>

        {/* Deductions breakdown */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col justify-between">
          <div>
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Revenue & Deductions Breakdown</h2>
            </div>
            <div className="divide-y divide-gray-100 text-sm">
              <div className="px-5 py-2.5 flex justify-between items-center">
                <span className="text-gray-600">Gross Booking Subtotal</span>
                <span className="font-medium text-gray-900 tabular-nums">+{formatCurrency(grossSubtotal)}</span>
              </div>
              {totalMembershipSales > 0 && (
                <div className="px-5 py-2.5 flex justify-between items-center text-emerald-600 bg-emerald-50/25 font-medium">
                  <span>Membership Plan Sales</span>
                  <span className="tabular-nums">+{formatCurrency(totalMembershipSales)}</span>
                </div>
              )}
              {totalCoupons > 0 && (
                <div className="px-5 py-2.5 flex justify-between items-center text-red-600 bg-red-50/25 font-medium">
                  <span>Coupons Applied</span>
                  <span className="tabular-nums">-{formatCurrency(totalCoupons)}</span>
                </div>
              )}
              {totalMemberships > 0 && (
                <div className="px-5 py-2.5 flex justify-between items-center text-red-600 bg-red-50/25 font-medium">
                  <span>Membership Discounts</span>
                  <span className="tabular-nums">-{formatCurrency(totalMemberships)}</span>
                </div>
              )}
              {totalFreeHours > 0 && (
                <div className="px-5 py-2.5 flex justify-between items-center text-red-600 bg-red-50/25 font-medium">
                  <span>Free Hours Value</span>
                  <span className="tabular-nums">-{formatCurrency(totalFreeHours)}</span>
                </div>
              )}
              {totalPoints > 0 && (
                <div className="px-5 py-2.5 flex justify-between items-center text-red-600 bg-red-50/25 font-medium">
                  <span>Loyalty Points Redeemed</span>
                  <span className="tabular-nums">-{formatCurrency(totalPoints)}</span>
                </div>
              )}
              <div className="px-5 py-3 flex justify-between items-center font-bold text-gray-900 bg-gray-50/30 border-y border-gray-100">
                <span>Net Revenue (Total Collected)</span>
                <span className="tabular-nums">{formatCurrency(totalRevenue)}</span>
              </div>
              {totalCostOfExtras > 0 && (
                <div className="px-5 py-2.5 flex justify-between items-center text-gray-500">
                  <span>Cost of Inventory Sold (COGS)</span>
                  <span className="font-medium tabular-nums">-{formatCurrency(totalCostOfExtras)}</span>
                </div>
              )}
            </div>
          </div>
          <div className="bg-gray-50/50 px-5 py-4 border-t border-gray-100 flex justify-between items-center">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Net Gross Profit</span>
            <span className="text-base font-bold text-emerald-600 tabular-nums">{formatCurrency(totalProfit)}</span>
          </div>
        </div>
      </div>

      {/* Monthly Performance History (MoM) */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-[#D4541A]" />
            <h2 className="font-semibold text-gray-900">Monthly Performance History</h2>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
            Last 6 Months
          </span>
        </div>

        {isHistoryLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading history...</div>
        ) : monthlyData.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No historical data available</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart column */}
            <div className="lg:col-span-2 flex flex-col justify-between">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Revenue Trend</p>
                <p className="text-xs text-gray-500">Historical monthly revenue comparison</p>
              </div>
              
              <div className="flex items-end gap-3 pt-6" style={{ height: 160 }}>
                {(() => {
                  const maxVal = Math.max(...monthlyData.map(d => d.revenue), 1);
                  return monthlyData.map((d) => {
                    const pct = d.revenue / maxVal;
                    const h   = Math.max(Math.round(pct * 110), d.revenue > 0 ? 5 : 0);
                    return (
                      <div key={d.monthKey} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                        {d.revenue > 0 && (
                          <span className="text-[10px] font-bold text-gray-800 tabular-nums">
                            {d.revenue >= 1000 ? `${(d.revenue / 1000).toFixed(0)}k` : Math.round(d.revenue)}
                          </span>
                        )}
                        <div
                          className="w-full rounded-t-lg transition-all duration-300 hover:opacity-90"
                          style={{
                            height: h,
                            minHeight: d.revenue > 0 ? 4 : 0,
                            background: "linear-gradient(180deg, #D4541A 0%, #a63f11 100%)",
                            boxShadow: "0 2px 8px rgba(212,84,26,0.15)",
                          }}
                          title={`${d.label} — ${formatCurrency(d.revenue)}`}
                        />
                        <span className="text-[10px] font-semibold text-gray-400 tabular-nums truncate w-full text-center">
                          {d.label.split(" ")[0]}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Table/List column */}
            <div className="border-t lg:border-t-0 lg:border-l border-gray-100 pt-6 lg:pt-0 lg:pl-6 space-y-4">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Breakdown</p>
              
              <div className="space-y-3 overflow-y-auto" style={{ maxHeight: 180 }}>
                {monthlyData.map((d, i) => {
                  const hasTrend = i > 0;
                  const isUp = d.MoM > 0;
                  const isDown = d.MoM < 0;
                  
                  return (
                    <div key={d.monthKey} className="flex items-center justify-between text-sm py-1">
                      <div>
                        <p className="font-semibold text-gray-900">{d.label}</p>
                        <p className="text-[11px] text-gray-400">{d.ordersCount} orders</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-gray-900 tabular-nums">{formatCurrency(d.revenue)}</p>
                        {hasTrend && d.revenue > 0 && (
                          <p className={`text-[10px] font-bold flex items-center justify-end gap-0.5 mt-0.5 ${
                            isUp ? "text-emerald-500" : isDown ? "text-red-400" : "text-gray-400"
                          }`}>
                            {isUp ? "+" : ""}{d.MoM}% MoM
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Top customers */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Users className="h-4 w-4 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Top Customers</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Phone</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Visits</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Spent</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {topCustomers.map((c, i) => (
              <tr key={c.phone}>
                <td className="px-4 py-3 font-medium text-gray-900">
                  <span className="inline-flex items-center gap-2">
                    <span className="text-xs text-gray-400 tabular-nums w-4">{i + 1}</span>
                    {c.name}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{c.phone}</td>
                <td className="px-4 py-3 text-right text-gray-500">{c.visits}</td>
                <td className="px-4 py-3 text-right text-gray-700 font-medium">{formatCurrency(c.spent)}</td>
              </tr>
            ))}
            {topCustomers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">No data for this period</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
