"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Users, TrendingUp, Star, Award, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { CustomerProfile } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { jsPDF } from "jspdf";

type Customer = Pick<
  CustomerProfile,
  "id" | "phone" | "name" | "visit_count" | "total_spent" | "points_balance" | "last_visit_at"
>;

type OrderRecord = {
  customer_phone: string;
  location_id: string;
};

type CustomerStats = {
  phone: string;
  points_balance: number;
  total_spent: number;
  visit_count: number;
};

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
  locations,
  orders = [],
  allStats = [],
  page = 1,
  totalPages = 1,
  totalCount = 0,
  globalTotalCustomers,
  globalRepeatCustomers,
  globalTotalPoints,
  globalTotalRevenue,
  currentQ = "",
  currentSortBy = "last_visit",
  currentMinVisits = "",
  currentMinPoints = "",
  currentLocation = "all",
}: {
  initialCustomers: Customer[];
  locations: { id: string; name: string }[];
  orders?: OrderRecord[];
  allStats?: CustomerStats[];
  page?: number;
  totalPages?: number;
  totalCount?: number;
  globalTotalCustomers?: number;
  globalRepeatCustomers?: number;
  globalTotalPoints?: number;
  globalTotalRevenue?: number;
  currentQ?: string;
  currentSortBy?: string;
  currentMinVisits?: string;
  currentMinPoints?: string;
  currentLocation?: string;
}) {
  const router = useRouter();
  const [selectedLocation, setSelectedLocation] = useState<string>(currentLocation);
  const [search,           setSearch]           = useState(currentQ);
  const [sortBy,           setSortBy]           = useState(currentSortBy);
  const [minVisits,        setMinVisits]        = useState(currentMinVisits);
  const [minPoints,        setMinPoints]        = useState(currentMinPoints);

  // Sync state with URL when back button or external route changes occur
  useEffect(() => { setSelectedLocation(currentLocation); }, [currentLocation]);
  useEffect(() => { setSearch(currentQ); }, [currentQ]);
  useEffect(() => { setSortBy(currentSortBy); }, [currentSortBy]);
  useEffect(() => { setMinVisits(currentMinVisits); }, [currentMinVisits]);
  useEffect(() => { setMinPoints(currentMinPoints); }, [currentMinPoints]);

  const updateFilters = (newParams: {
    page?: number;
    q?: string;
    sortBy?: string;
    minVisits?: string;
    minPoints?: string;
    location?: string;
  }) => {
    const params = new URLSearchParams(window.location.search);
    
    if (newParams.page !== undefined) {
      params.set("page", String(newParams.page));
    } else {
      params.set("page", "1"); // Reset to page 1 on filter change
    }

    if (newParams.q !== undefined) {
      if (newParams.q.trim()) params.set("q", newParams.q.trim());
      else params.delete("q");
    }
    if (newParams.sortBy !== undefined) {
      params.set("sortBy", newParams.sortBy);
    }
    if (newParams.minVisits !== undefined) {
      if (newParams.minVisits.trim()) params.set("minVisits", newParams.minVisits.trim());
      else params.delete("minVisits");
    }
    if (newParams.minPoints !== undefined) {
      if (newParams.minPoints.trim()) params.set("minPoints", newParams.minPoints.trim());
      else params.delete("minPoints");
    }
    if (newParams.location !== undefined) {
      params.set("location", newParams.location);
    }
    
    router.push(`/owner/customers?${params.toString()}`);
  };

  // Debounced search input trigger
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== currentQ) {
        updateFilters({ q: search });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [search, currentQ]);

  const handleLocationChange = (val: string) => {
    setSelectedLocation(val);
    updateFilters({ location: val });
  };

  const handleSortChange = (val: string) => {
    setSortBy(val);
    updateFilters({ sortBy: val });
  };

  const handleMinVisitsChange = (val: string) => {
    setMinVisits(val);
    updateFilters({ minVisits: val });
  };

  const handleMinPointsChange = (val: string) => {
    setMinPoints(val);
    updateFilters({ minPoints: val });
  };

  // Build phone set for the selected location
  const locationPhoneSet = useMemo(() => {
    if (selectedLocation === "all" || !orders.length) return null;
    const set = new Set<string>();
    for (const o of orders) {
      if (o.location_id === selectedLocation && o.customer_phone) {
        set.add(o.customer_phone);
      }
    }
    return set;
  }, [selectedLocation, orders]);

  // Customers is already paginated/sorted/filtered by the server!
  const customers = initialCustomers;

  // Stats computation across all pages
  const totalCustomers = useMemo(() => {
    if (selectedLocation === "all") return globalTotalCustomers ?? totalCount;
    if (!locationPhoneSet) return 0;
    return allStats.filter(c => locationPhoneSet.has(c.phone)).length;
  }, [selectedLocation, locationPhoneSet, allStats, globalTotalCustomers, totalCount]);

  const repeatCustomers = useMemo(() => {
    if (selectedLocation === "all") return globalRepeatCustomers ?? 0;
    if (!locationPhoneSet) return 0;
    return allStats.filter(c => locationPhoneSet.has(c.phone) && c.visit_count > 1).length;
  }, [selectedLocation, locationPhoneSet, allStats, globalRepeatCustomers]);

  const totalPoints = useMemo(() => {
    if (selectedLocation === "all") return globalTotalPoints ?? 0;
    if (!locationPhoneSet) return 0;
    return allStats.filter(c => locationPhoneSet.has(c.phone)).reduce((s, c) => s + (c.points_balance || 0), 0);
  }, [selectedLocation, locationPhoneSet, allStats, globalTotalPoints]);

  const totalRevenue = useMemo(() => {
    if (selectedLocation === "all") return globalTotalRevenue ?? 0;
    if (!locationPhoneSet) return 0;
    return allStats.filter(c => locationPhoneSet.has(c.phone)).reduce((s, c) => s + (c.total_spent || 0), 0);
  }, [selectedLocation, locationPhoneSet, allStats, globalTotalRevenue]);

  const stats = [
    { label: "Total Customers",       value: totalCustomers,                            icon: Users,     color: "text-blue-600",   bg: "bg-blue-50"   },
    { label: "Repeat Customers",      value: repeatCustomers,                           icon: TrendingUp, color: "text-green-600", bg: "bg-green-50"  },
    { label: "Points in Circulation", value: `${totalPoints.toLocaleString("en-IN")} pts`, icon: Star,   color: "text-amber-600",  bg: "bg-amber-50"  },
    { label: "Total Revenue",         value: formatCurrency(totalRevenue),               icon: Award,    color: "text-purple-600", bg: "bg-purple-50" },
  ];

  const handleDownloadPDF = () => {
    const doc = new jsPDF();
    const locName = selectedLocation === "all"
      ? "All Locations"
      : (locations.find((l) => l.id === selectedLocation)?.name ?? "Selected Location");

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(212, 84, 26); // #D4541A Gamehaus Orange
    doc.text(`Gamehaus Customer Directory`, 14, 20);

    // Metadata
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Location: ${locName}`, 14, 27);
    doc.text(
      `Generated: ${new Date().toLocaleDateString("en-IN")} at ${new Date().toLocaleTimeString("en-IN")}`,
      14,
      32
    );

    // Summary Box
    doc.setFillColor(243, 244, 246); // bg-gray-100
    doc.rect(14, 38, 182, 18, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text("TOTAL CUSTOMERS", 20, 44);
    doc.text("TOTAL SPENT", 80, 44);
    doc.text("TOTAL POINTS", 140, 44);

    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(`${customers.length}`, 20, 51);

    const pdfTotalRevenue = customers.reduce((s, c) => s + c.total_spent, 0);
    const pdfTotalPoints = customers.reduce((s, c) => s + c.points_balance, 0);

    doc.text(`INR ${pdfTotalRevenue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 80, 51);
    doc.text(`${pdfTotalPoints.toLocaleString("en-IN")} pts`, 140, 51);

    // Table Headers
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(50, 50, 50);

    doc.setDrawColor(200, 200, 200);
    doc.line(14, 63, 196, 63);

    doc.text("Customer Name", 16, 68);
    doc.text("Phone Number", 75, 68);
    doc.text("Visits", 115, 68);
    doc.text("Loyalty Points", 135, 68);
    doc.text("Total Spent", 165, 68);

    doc.line(14, 72, 196, 72);

    // Rows
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);

    let y = 78;
    const pageHeight = doc.internal.pageSize.height;

    customers.forEach((c, idx) => {
      if (y > pageHeight - 15) {
        doc.addPage();

        // Headers on new page
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(50, 50, 50);
        doc.setDrawColor(200, 200, 200);
        doc.line(14, 15, 196, 15);
        doc.text("Customer Name", 16, 20);
        doc.text("Phone Number", 75, 20);
        doc.text("Visits", 115, 20);
        doc.text("Loyalty Points", 135, 20);
        doc.text("Total Spent", 165, 20);
        doc.line(14, 24, 196, 24);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(80, 80, 80);
        y = 30;
      }

      // Zebra striping
      if (idx % 2 === 1) {
        doc.setFillColor(250, 250, 250);
        doc.rect(14, y - 5, 182, 7, "F");
      }

      doc.text(c.name ?? "—", 16, y);
      doc.text(c.phone, 75, y);
      doc.text(`${c.visit_count}`, 115, y);
      doc.text(`${c.points_balance} pts`, 135, y);
      doc.text(`INR ${c.total_spent.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 165, y);

      doc.setDrawColor(240, 240, 240);
      doc.line(14, y + 2, 196, y + 2);

      y += 8;
    });

    const fileLocSuffix = locName.toLowerCase().replace(/\s+/g, "-");
    doc.save(`gamehaus-customers-${fileLocSuffix}-${new Date().toISOString().split("T")[0]}.pdf`);
  };

  const goToPage = (p: number) => {
    const params = new URLSearchParams(window.location.search);
    params.set("page", String(p));
    router.push(`/owner/customers?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Customers</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {search || minVisits || minPoints
              ? `Showing ${customers.length} matching customers (page ${page} of ${totalPages} · ${totalCount.toLocaleString("en-IN")} total)`
              : `${totalCount.toLocaleString("en-IN")} total customers · page ${page} of ${totalPages}`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={handleDownloadPDF}
            variant="outline"
            className="flex items-center gap-2 border-gray-200 text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-xl"
            disabled={customers.length === 0}
          >
            <Download className="h-4 w-4" />
            <span>Download PDF</span>
          </Button>

          {/* Location Selector */}
          <div className="w-52">
            <Select value={selectedLocation} onValueChange={handleLocationChange}>
              <SelectTrigger>
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
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
          onChange={(e) => handleMinVisitsChange(e.target.value)}
          className="w-28"
          min="0"
        />
        <Input
          type="number"
          placeholder="Min points"
          value={minPoints}
          onChange={(e) => handleMinPointsChange(e.target.value)}
          className="w-28"
          min="0"
        />
        <Select value={sortBy} onValueChange={handleSortChange}>
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

      {/* Pagination bar (Top) */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border border-gray-100 bg-gray-50/50 rounded-xl px-4 py-2.5 gap-2 text-sm">
          <span className="text-gray-500 font-medium">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="flex items-center gap-1 h-8 text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </Button>

            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => goToPage(p)}
                  className={`w-8 h-8 rounded-lg text-xs font-semibold transition-colors ${
                    p === page
                      ? "bg-gray-900 text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="flex items-center gap-1 h-8 text-xs"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

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
                  No customers found for this location
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination bar */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            className="flex items-center gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>

          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => goToPage(p)}
                className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                  p === page
                    ? "bg-gray-900 text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
            className="flex items-center gap-1"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
