"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { BarChart2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const supabase = createClient();

export default function ReportsPage() {
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const [from, setFrom] = useState(thirtyDaysAgo);
  const [to, setTo] = useState(today);

  const { data: reportData, isLoading } = useQuery({
    queryKey: ["reports", from, to],
    queryFn: async () => {
      const fromISO = new Date(from).toISOString();
      const toISO = new Date(to + "T23:59:59Z").toISOString();

      const [{ data: orders }, { data: locations }] = await Promise.all([
        supabase
          .from("orders")
          .select(`
            *,
            items:order_items(*, table:tables(name, location_id)),
            payments(*),
            location:locations(name)
          `)
          .eq("status", "finalized")
          .gte("finalized_at", fromISO)
          .lte("finalized_at", toISO),
        supabase.from("locations").select("*").eq("is_active", true),
      ]);

      return { orders: orders ?? [], locations: locations ?? [] };
    },
  });

  const orders = reportData?.orders ?? [];
  const locations = reportData?.locations ?? [];

  // Revenue by location
  const revenueByLocation = locations.map((loc) => {
    const locOrders = orders.filter(
      (o) => (o.location as { name: string }).name === loc.name
    );
    const revenue = locOrders.reduce(
      (s, o) => s + (o.total_amount ?? 0),
      0
    );
    const sessionCount = locOrders.flatMap((o) =>
      (o.items as Array<{ status: string }>).filter(
        (i) => i.status === "finished"
      )
    ).length;
    return { name: loc.name, revenue, sessionCount, orderCount: locOrders.length };
  });

  const totalRevenue = revenueByLocation.reduce((s, l) => s + l.revenue, 0);

  // Top customers
  const customerMap = new Map<string, { name: string; visits: number; spent: number }>();
  for (const order of orders) {
    if (!order.customer_phone) continue;
    const existing = customerMap.get(order.customer_phone) ?? {
      name: order.customer_name,
      visits: 0,
      spent: 0,
    };
    customerMap.set(order.customer_phone, {
      name: existing.name,
      visits: existing.visits + 1,
      spent: existing.spent + (order.total_amount ?? 0),
    });
  }
  const topCustomers = [...customerMap.entries()]
    .map(([phone, data]) => ({ phone, ...data }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
      </div>

      {/* Date range */}
      <div className="flex items-center gap-4 bg-white rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm text-gray-500 whitespace-nowrap">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm text-gray-500 whitespace-nowrap">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
        </div>
      </div>

      {isLoading && <p className="text-gray-500">Loading...</p>}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border p-5">
          <p className="text-sm text-gray-500">Total Revenue</p>
          <p className="text-3xl font-bold mt-1">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="bg-white rounded-lg border p-5">
          <p className="text-sm text-gray-500">Total Orders</p>
          <p className="text-3xl font-bold mt-1">{orders.length}</p>
        </div>
        <div className="bg-white rounded-lg border p-5">
          <p className="text-sm text-gray-500">Total Sessions</p>
          <p className="text-3xl font-bold mt-1">
            {orders.flatMap((o) =>
              (o.items as Array<{ status: string }>).filter(
                (i) => i.status === "finished"
              )
            ).length}
          </p>
        </div>
      </div>

      {/* By location */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Revenue by Location</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
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
                <td className="px-4 py-3 text-right text-gray-700">
                  {formatCurrency(row.revenue)}
                </td>
                <td className="px-4 py-3 text-right text-gray-500">{row.orderCount}</td>
                <td className="px-4 py-3 text-right text-gray-500">{row.sessionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top customers */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Top Customers</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Phone</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Visits</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Spent</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {topCustomers.map((c) => (
              <tr key={c.phone}>
                <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                <td className="px-4 py-3 text-gray-500">{c.phone}</td>
                <td className="px-4 py-3 text-right text-gray-500">{c.visits}</td>
                <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(c.spent)}</td>
              </tr>
            ))}
            {topCustomers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  No data for this period
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
