"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  type: string;
  finalized_at: string | null;
  location: { id: string; name: string } | null;
  items: Array<{ status: string }>;
  payments: Array<{ method: string; amount: number; status: string }>;
};

type ReportLocation = {
  id: string;
  name: string;
  opening_time: string;
  closing_time: string;
};

export function ReportsContent({
  initialReportData,
  initialFrom,
  initialTo,
}: {
  initialReportData: { orders: ReportOrder[]; locations: ReportLocation[] };
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

  const { data: reportData, isLoading } = useQuery<{ orders: ReportOrder[]; locations: ReportLocation[] }>({
    queryKey: ["reports", from, to],
    queryFn: async () => {
      // Fetch location hours first — day boundary is opening→closing, not midnight
      const { data: locations } = await supabase
        .from("locations").select("*").eq("is_active", true);

      const loc     = locations?.[0];
      const opening = loc?.opening_time ?? "10:00";
      const closing = loc?.closing_time ?? "23:00";

      const [openH]  = opening.split(":").map(Number);
      const [closeH] = closing.split(":").map(Number);
      const crossesMidnight = closeH < openH;

      const fromISO = new Date(from + "T" + opening + "+05:30").toISOString();
      const toEndDate = crossesMidnight
        ? (() => { const d = new Date(to + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().split("T")[0]; })()
        : to;
      const toISO = new Date(toEndDate + "T" + closing + "+05:30").toISOString();

      const { data: orders } = await supabase
        .from("orders")
        .select(`
          id, customer_name, customer_phone, amount_due, advance_paid, type, finalized_at,
          location:locations(id, name),
          items:order_items(status),
          payments(method, amount, status)
        `)
        .eq("status", "finalized")
        .gte("finalized_at", fromISO)
        .lte("finalized_at", toISO);

      return { orders: (orders ?? []) as ReportOrder[], locations: (locations ?? []) as ReportLocation[] };
    },
    initialData: initialReportData,
  });

  const orders    = reportData?.orders    ?? [];
  const locations = reportData?.locations ?? [];

  const filteredOrders = selectedLocationId
    ? orders.filter((o) => o.location?.id === selectedLocationId)
    : orders;

  // Revenue by location
  const revenueByLocation = locations.map((loc) => {
    const locOrders    = filteredOrders.filter((o) => o.location?.id === loc.id);
    const revenue      = locOrders.reduce((s, o) => s + (o.amount_due ?? 0) + (o.advance_paid ?? 0), 0);
    const sessionCount = locOrders.flatMap((o) =>
      o.items.filter((i) => i.status === "finished")
    ).length;
    return { name: loc.name, revenue, sessionCount, orderCount: locOrders.length };
  });

  const totalRevenue  = revenueByLocation.reduce((s, l) => s + l.revenue, 0);
  const totalSessions = revenueByLocation.reduce((s, l) => s + l.sessionCount, 0);

  // Payment method breakdown
  const methodMap = new Map<string, number>();
  for (const order of filteredOrders) {
    for (const p of order.payments) {
      if (p.status !== "completed") continue;
      methodMap.set(p.method, (methodMap.get(p.method) ?? 0) + (p.amount ?? 0));
    }
  }
  const paymentBreakdown = [...methodMap.entries()]
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount);

  // Top customers
  const customerMap = new Map<string, { name: string; visits: number; spent: number }>();
  for (const order of filteredOrders) {
    if (!order.customer_phone) continue;
    const existing = customerMap.get(order.customer_phone) ?? { name: order.customer_name, visits: 0, spent: 0 };
    customerMap.set(order.customer_phone, {
      name:   existing.name,
      visits: existing.visits + 1,
      spent:  existing.spent + (order.amount_due ?? 0),
    });
  }
  const topCustomers = [...customerMap.entries()]
    .map(([phone, data]) => ({ phone, ...data }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 10);

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400">Total Revenue</p>
          <p className="text-3xl font-bold mt-2 tabular-nums">{formatCurrency(totalRevenue)}</p>
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
                const pct = totalRevenue > 0 ? Math.round((amount / totalRevenue) * 100) : 0;
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
