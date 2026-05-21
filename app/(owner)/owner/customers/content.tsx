"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Users, TrendingUp, Star, Award } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { CustomerProfile } from "@/lib/supabase/types";

type Customer = Pick<
  CustomerProfile,
  "id" | "phone" | "name" | "visit_count" | "total_spent" | "points_balance" | "last_visit_at"
>;

const SORT_OPTIONS = [
  { value: "last_visit",     label: "Last visit" },
  { value: "total_spent",    label: "Total spent" },
  { value: "visit_count",    label: "Visit count" },
  { value: "points_balance", label: "Points balance" },
];

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export function CustomersContent({
  initialCustomers,
  locations: _locations,
}: {
  initialCustomers: Customer[];
  locations: { id: string; name: string }[];
}) {
  const [search,    setSearch]    = useState("");
  const [sortBy,    setSortBy]    = useState("last_visit");
  const [minVisits, setMinVisits] = useState("");
  const [minPoints, setMinPoints] = useState("");

  const customers = useMemo(() => {
    let list = [...initialCustomers];

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((c) =>
        (c.name ?? "").toLowerCase().includes(q) || c.phone.includes(q)
      );
    }
    if (minVisits) list = list.filter((c) => c.visit_count >= parseInt(minVisits));
    if (minPoints) list = list.filter((c) => c.points_balance >= parseInt(minPoints));

    list.sort((a, b) => {
      switch (sortBy) {
        case "total_spent":    return b.total_spent - a.total_spent;
        case "visit_count":    return b.visit_count - a.visit_count;
        case "points_balance": return b.points_balance - a.points_balance;
        default: {
          const ta = a.last_visit_at ? new Date(a.last_visit_at).getTime() : 0;
          const tb = b.last_visit_at ? new Date(b.last_visit_at).getTime() : 0;
          return tb - ta;
        }
      }
    });

    return list;
  }, [initialCustomers, search, sortBy, minVisits, minPoints]);

  const totalCustomers  = initialCustomers.length;
  const repeatCustomers = initialCustomers.filter((c) => c.visit_count > 1).length;
  const totalPoints     = initialCustomers.reduce((s, c) => s + c.points_balance, 0);
  const totalRevenue    = initialCustomers.reduce((s, c) => s + c.total_spent, 0);

  const stats = [
    { label: "Total Customers",       value: totalCustomers,                            icon: Users,     color: "text-blue-600",   bg: "bg-blue-50"   },
    { label: "Repeat Customers",      value: repeatCustomers,                           icon: TrendingUp, color: "text-green-600", bg: "bg-green-50"  },
    { label: "Points in Circulation", value: `${totalPoints.toLocaleString("en-IN")} pts`, icon: Star,   color: "text-amber-600",  bg: "bg-amber-50"  },
    { label: "Total Revenue",         value: formatCurrency(totalRevenue),               icon: Award,    color: "text-purple-600", bg: "bg-purple-50" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Customers</h1>
        <span className="text-sm text-gray-400">
          {customers.length} of {totalCustomers}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`${bg} rounded-lg p-1.5`}>
                <Icon className={`h-3.5 w-3.5 ${color}`} />
              </div>
              <span className="text-xs text-gray-500">{label}</span>
            </div>
            <p className="text-xl font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Input
          type="number"
          placeholder="Min visits"
          value={minVisits}
          onChange={(e) => setMinVisits(e.target.value)}
          className="w-28"
          min="0"
        />
        <Input
          type="number"
          placeholder="Min points"
          value={minPoints}
          onChange={(e) => setMinPoints(e.target.value)}
          className="w-28"
          min="0"
        />
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Phone</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Visits</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Total Spent</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Points</th>
              <th className="px-4 py-3 text-right font-medium text-gray-600">Last Visit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{c.name ?? "—"}</p>
                    {c.visit_count >= 10 && (
                      <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 py-0">VIP</Badge>
                    )}
                    {c.visit_count >= 5 && c.visit_count < 10 && (
                      <Badge variant="outline" className="text-[10px] py-0">Regular</Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{c.phone}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">{c.visit_count}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">
                  {formatCurrency(c.total_spent)}
                </td>
                <td className="px-4 py-3 text-right">
                  {c.points_balance > 0 ? (
                    <span className="font-medium text-amber-600">{c.points_balance.toLocaleString("en-IN")} pts</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-gray-500 text-xs">{fmtDate(c.last_visit_at)}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  No customers found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
