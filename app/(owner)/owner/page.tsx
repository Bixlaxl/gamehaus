export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";
import { DashboardRefresh } from "@/components/owner/dashboard-refresh";
import {
  TrendingUp, Zap, Calendar, Receipt,
  ArrowUpRight, ArrowDownRight, Minus,
  Clock, Flame, Snowflake, Package, Crown,
} from "lucide-react";

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, accent, icon, trend, trendLabel = "vs yesterday",
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
  icon: React.ReactNode;
  trend?: number;
  trendLabel?: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-2 leading-none tabular-nums">{value}</p>
          <div className="mt-2 flex items-center gap-2 flex-wrap min-h-[16px]">
            {sub && <p className="text-xs text-gray-400">{sub}</p>}
            {trend !== undefined && (
              <span
                className={`inline-flex items-center gap-0.5 text-[11px] font-bold ${
                  trend > 0 ? "text-emerald-500" : trend < 0 ? "text-red-400" : "text-gray-400"
                }`}
              >
                {trend > 0
                  ? <ArrowUpRight className="h-3 w-3" />
                  : trend < 0
                  ? <ArrowDownRight className="h-3 w-3" />
                  : <Minus className="h-3 w-3" />}
                {Math.abs(trend)}% {trendLabel}
              </span>
            )}
          </div>
        </div>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: accent + "18" }}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

// ── 7-day bar chart ───────────────────────────────────────────────────────────
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function RevenueChart({ data }: { data: { date: Date; revenue: number }[] }) {
  const max      = Math.max(...data.map((d) => d.revenue), 1);
  const BAR_MAX_H = 96;

  return (
    <div className="flex items-stretch gap-1.5" style={{ height: 140 }}>
      {data.map((d, i) => {
        const barH    = d.revenue > 0 ? Math.max(Math.round((d.revenue / max) * BAR_MAX_H), 5) : 0;
        const isToday = i === data.length - 1;
        const label   = isToday ? "Today" : DAY_ABBR[d.date.getDay()];
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
            {d.revenue > 0 && (
              <span className="text-[9px] font-semibold text-gray-400 tabular-nums leading-none">
                {d.revenue >= 1000 ? `${(d.revenue / 1000).toFixed(1)}k` : Math.round(d.revenue).toString()}
              </span>
            )}
            <div
              className="w-full rounded-t-md"
              style={{ height: barH, background: isToday ? "#D4541A" : "#F0ECE7", minHeight: barH > 0 ? 4 : 0 }}
            />
            <span className={`text-[10px] font-semibold ${isToday ? "text-gray-800" : "text-gray-400"}`}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function tableIcon(type: string) {
  if (type === "ps5")      return "🎮";
  if (type === "foosball") return "⚽";
  if (type === "snooker" || type === "pool") return "🎱";
  return "🎯";
}

function elapsed(start: string): string {
  const totalMins = Math.floor((Date.now() - new Date(start).getTime()) / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

function shiftDayStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function businessDayBounds(dateStr: string, opening: string, closing: string) {
  const [openH, openM]   = opening.split(":").map(Number);
  const [closeH, closeM] = closing.split(":").map(Number);
  const crossesMidnight  = closeH < openH || (closeH === openH && closeM < openM);
  const start            = new Date(`${dateStr}T${opening}+05:30`);
  const endDateStr       = crossesMidnight ? shiftDayStr(dateStr, 1) : dateStr;
  const end              = new Date(`${endDateStr}T${closing}+05:30`);
  return { start, end };
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default async function OwnerDashboard({
  searchParams,
}: {
  searchParams: Promise<{ loc?: string }>;
}) {
  const { loc: selectedLocId } = await searchParams;
  const admin = createAdminClient();

  // All locations — used for tabs and hours
  const { data: allLocations } = await admin
    .from("locations")
    .select("id, name, opening_time, closing_time")
    .eq("is_active", true)
    .order("name");

  const selectedLocData = selectedLocId ? allLocations?.find((l) => l.id === selectedLocId) : null;
  const locationHours   = selectedLocData ?? allLocations?.[0];
  const opening = locationHours?.opening_time ?? "10:00";
  const closing = locationHours?.closing_time ?? "23:00";

  // Business-day bounds
  const now          = new Date();
  const istOffsetMs  = 5.5 * 60 * 60 * 1000;
  const nowIST       = new Date(now.getTime() + istOffsetMs);
  const [closeH, closeM] = closing.split(":").map(Number);
  const [openH]          = opening.split(":").map(Number);
  const crossesMidnight  = closeH < openH;
  const todayISTStr      = nowIST.toISOString().split("T")[0];
  const inEarlyHours     = crossesMidnight &&
    (nowIST.getUTCHours() < closeH || (nowIST.getUTCHours() === closeH && nowIST.getUTCMinutes() < closeM));
  const bizDateStr      = inEarlyHours ? shiftDayStr(todayISTStr, -1) : todayISTStr;
  const yesterdayBizStr = shiftDayStr(bizDateStr, -1);

  const { start: todayStart, end: todayEnd }         = businessDayBounds(bizDateStr, opening, closing);
  const { start: yesterdayStart, end: yesterdayEnd } = businessDayBounds(yesterdayBizStr, opening, closing);

  const bizYear       = parseInt(bizDateStr.slice(0, 4));
  const bizMonth      = parseInt(bizDateStr.slice(5, 7));
  const monthFirstStr = `${bizYear}-${String(bizMonth).padStart(2, "0")}-01`;
  const monthStart    = new Date(`${monthFirstStr}T${opening}+05:30`);
  const lastMonthYear = bizMonth === 1 ? bizYear - 1 : bizYear;
  const lastMonthVal  = bizMonth === 1 ? 12 : bizMonth - 1;
  const lastMonthFirstStr = `${lastMonthYear}-${String(lastMonthVal).padStart(2, "0")}-01`;
  const lastMonthStart    = new Date(`${lastMonthFirstStr}T${opening}+05:30`);
  const sevenDaysAgo  = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  // 30-day window for insights — long enough to smooth out daily noise
  // for peak-hour / best-seller / table-revenue rankings.
  const thirtyDaysAgo = new Date(todayStart);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

  // All queries fetch location_id so we can filter in JS
  const [
    { data: todayOrders },
    { data: yesterdayOrders },
    { data: monthOrders },
    { data: lastMonthOrders },
    { data: allLiveSessions },
    { data: allTodayBookings },
    { data: allRecentOrders },
    { data: weekOrders },
    { data: allLiveDetail },
    { data: insightItems },
    { data: insightExtras },
  ] = await Promise.all([
    admin.from("orders").select("amount_due, advance_paid, location_id")
      .eq("status", "finalized")
      .gte("finalized_at", todayStart.toISOString())
      .lte("finalized_at", todayEnd.toISOString()),

    admin.from("orders").select("amount_due, advance_paid, location_id")
      .eq("status", "finalized")
      .gte("finalized_at", yesterdayStart.toISOString())
      .lte("finalized_at", yesterdayEnd.toISOString()),

    admin.from("orders").select("amount_due, advance_paid, location_id")
      .eq("status", "finalized")
      .gte("finalized_at", monthStart.toISOString()),

    admin.from("orders").select("amount_due, advance_paid, location_id")
      .eq("status", "finalized")
      .gte("finalized_at", lastMonthStart.toISOString())
      .lt("finalized_at", monthStart.toISOString()),

    // Live sessions — join tables to get location
    admin.from("order_items")
      .select("id, table:tables!inner(location_id)")
      .eq("status", "running"),

    // Bookings — join orders to get location
    admin.from("bookings")
      .select("id, order:orders!inner(location_id, type, status, advance_paid)")
      .eq("status", "confirmed")
      .gte("scheduled_start", todayStart.toISOString())
      .lte("scheduled_start", todayEnd.toISOString()),

    // Fetch 20 so after location-filter we still have enough to show 8
    admin.from("orders")
      .select("id, customer_name, customer_phone, amount_due, advance_paid, location_id, type, finalized_at, location:locations(name)")
      .eq("status", "finalized")
      .order("finalized_at", { ascending: false })
      .limit(20),

    admin.from("orders").select("amount_due, advance_paid, location_id, finalized_at")
      .eq("status", "finalized")
      .gte("finalized_at", sevenDaysAgo.toISOString()),

    admin.from("order_items")
      .select("id, actual_start, rate_per_hour, order:orders(customer_name), table:tables(name, type, location_id)")
      .eq("status", "running")
      .order("actual_start", { ascending: true })
      .limit(20),

    // ── Insights window (last 30 days) — all 3 read from the same join shape
    //    so we filter by location in JS without an extra round trip ─────────
    // Finished order_items → drives Peak/Slow hours AND Most-profitable table.
    // We include table because Most-profitable groups by it, and we filter by
    // table.location_id to honour the location tab.
    admin.from("order_items")
      .select("actual_start, final_amount, table_id, table:tables(name, type, location_id)")
      .eq("status", "finished")
      .gte("actual_start", thirtyDaysAgo.toISOString()),

    // Sold extras → drives Best-selling items. Join order for location
    // scoping AND inventory_item for the LIVE catalogue name (the row's
    // own `name` column is a snapshot from sale time, so renaming a drink
    // in inventory wouldn't otherwise reflect on the dashboard).
    admin.from("order_extras")
      .select("name, price, quantity, order:orders!inner(location_id, status), inventory_item:inventory_items(name)")
      .eq("is_deleted", false)
      .eq("order.status", "finalized")
      .gte("created_at", thirtyDaysAgo.toISOString()),
  ]);

  // Rest of the destructure happens after — but since we added 2 elements
  // we need to pull them off the result array manually below.

  // ── Location filters (applied in JS) ─────────────────────────────────────────
  const loc = selectedLocId;
  const filterLoc      = (o: { location_id?: string | null })  => !loc || o.location_id === loc;
  const filterTableLoc = (s: { table?: unknown })               =>
    !loc || (s.table as { location_id?: string } | null)?.location_id === loc;
  const filterOrderLoc = (b: { order?: unknown })               =>
    !loc || (b.order as { location_id?: string } | null)?.location_id === loc;

  const orderTotal = (o: { amount_due?: number | null; advance_paid?: number | null }) =>
    (o.amount_due ?? 0) + (o.advance_paid ?? 0);

  const filteredToday      = (todayOrders      ?? []).filter(filterLoc);
  const filteredYesterday  = (yesterdayOrders  ?? []).filter(filterLoc);
  const filteredMonth      = (monthOrders      ?? []).filter(filterLoc);
  const filteredLastMonth  = (lastMonthOrders  ?? []).filter(filterLoc);
  const filteredWeek       = (weekOrders       ?? []).filter(filterLoc);
  const filteredLive       = (allLiveSessions  ?? []).filter(filterTableLoc);
  const filteredBookings   = (allTodayBookings ?? [])
    .filter(filterOrderLoc)
    .filter((b: any) => {
      const o = b.order;
      if (o && o.type === "online" && (o.advance_paid ?? 0) === 0 && o.status === "open") {
        return false;
      }
      return true;
    });
  const filteredRecent     = (allRecentOrders  ?? []).filter(filterLoc).slice(0, 8);
  const filteredLiveDetail = (allLiveDetail    ?? []).filter(filterTableLoc).slice(0, 8);

  const todayRevenue     = filteredToday.reduce((s, o)     => s + orderTotal(o), 0);
  const yesterdayRevenue = filteredYesterday.reduce((s, o) => s + orderTotal(o), 0);
  const monthRevenue     = filteredMonth.reduce((s, o)     => s + orderTotal(o), 0);
  const lastMonthRevenue = filteredLastMonth.reduce((s, o) => s + orderTotal(o), 0);
  const liveCount        = filteredLive.length;
  const bookingsToday    = filteredBookings.length;

  const revenueTrend =
    yesterdayRevenue > 0
      ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
      : todayRevenue > 0 ? 100 : 0;

  const monthTrend =
    lastMonthRevenue > 0
      ? Math.round(((monthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
      : monthRevenue > 0 ? 100 : 0;

  // 7-day chart
  const weekData: { date: Date; revenue: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStr = shiftDayStr(bizDateStr, -i);
    const { start: dayStart, end: dayEnd } = businessDayBounds(dayStr, opening, closing);
    const revenue = filteredWeek
      .filter((o) => { const t = new Date(o.finalized_at!); return t >= dayStart && t <= dayEnd; })
      .reduce((s, o) => s + orderTotal(o), 0);
    weekData.push({ date: dayStart, revenue });
  }
  const weekTotal = weekData.reduce((s, d) => s + d.revenue, 0);

  // ── 30-day insights: peak/slow hours, best sellers, profitable tables ──
  // Convert ISO timestamp to IST hour (0-23). Edge runtime is UTC so we
  // shift by +5:30 before reading the hour.
  const istHourOf = (iso: string) => {
    const ms = new Date(iso).getTime() + 5.5 * 60 * 60 * 1000;
    return new Date(ms).getUTCHours();
  };

  // Filter items by selected location (via table.location_id) before any aggregation
  const filteredInsightItems = (insightItems ?? []).filter(
    (i) => !loc || (i.table as { location_id?: string } | null)?.location_id === loc
  );

  // Peak/Slow: bucket sessions by IST start hour. Only show hours within
  // the location's operating window so "3 AM" doesn't appear as "slow".
  const opensHour  = parseInt(opening.split(":")[0]);
  const closesHour = parseInt(closing.split(":")[0]);
  const operatingHours: number[] = [];
  if (crossesMidnight) {
    for (let h = opensHour; h < 24; h++)     operatingHours.push(h);
    for (let h = 0;        h < closesHour; h++) operatingHours.push(h);
  } else {
    for (let h = opensHour; h < closesHour; h++) operatingHours.push(h);
  }
  const hourBuckets: Record<number, number> = {};
  for (const h of operatingHours) hourBuckets[h] = 0;
  for (const item of filteredInsightItems) {
    if (!item.actual_start) continue;
    const h = istHourOf(item.actual_start);
    if (h in hourBuckets) hourBuckets[h]++;
  }
  const sessionsByHour = operatingHours.map((h) => ({ hour: h, count: hourBuckets[h] }));
  const maxHourCount   = Math.max(...sessionsByHour.map((b) => b.count), 1);
  const hasHourData    = sessionsByHour.some((b) => b.count > 0);
  const sortedHours    = [...sessionsByHour].sort((a, b) => b.count - a.count);
  const peakHours      = hasHourData ? sortedHours.slice(0, 3).filter((b) => b.count > 0) : [];
  const slowHours      = hasHourData
    ? [...sortedHours].reverse().slice(0, 3).filter((b) => b.count >= 0)
    : [];

  // Best-selling items — group by name (same item name across locations rolls up).
  // The join shape confuses Supabase's inferred row type when !inner is in
  // play; explicit shape here keeps the rest of the pipeline typed cleanly.
  type ExtraRow = {
    name: string;
    price: number;
    quantity: number;
    order: { location_id: string | null; status: string } | { location_id: string | null; status: string }[] | null;
    inventory_item: { name: string } | { name: string }[] | null;
  };
  const insightExtrasTyped = (insightExtras ?? []) as unknown as ExtraRow[];
  const filteredInsightExtras = insightExtrasTyped.filter((e) => {
    if (!loc) return true;
    const o = Array.isArray(e.order) ? e.order[0] : e.order;
    return o?.location_id === loc;
  });
  const sellerMap: Record<string, { name: string; units: number; revenue: number }> = {};
  for (const e of filteredInsightExtras) {
    // Prefer the LIVE catalogue name so a rename in /owner/inventory
    // reflects on the dashboard. Falls back to the row's snapshotted name
    // for legacy custom extras or items that were permanently deleted.
    const invItem = Array.isArray(e.inventory_item) ? e.inventory_item[0] : e.inventory_item;
    const liveName = invItem?.name ?? e.name;
    if (!sellerMap[liveName]) sellerMap[liveName] = { name: liveName, units: 0, revenue: 0 };
    sellerMap[liveName].units   += e.quantity;
    sellerMap[liveName].revenue += e.price * e.quantity;
  }
  const topSellers = Object.values(sellerMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Most-profitable tables — sum final_amount per table_id
  const tableMap: Record<string, { name: string; type: string; revenue: number; sessions: number }> = {};
  for (const item of filteredInsightItems) {
    const t = item.table as { name: string; type: string } | null;
    if (!t) continue;
    if (!tableMap[item.table_id]) tableMap[item.table_id] = { name: t.name, type: t.type, revenue: 0, sessions: 0 };
    tableMap[item.table_id].revenue += item.final_amount ?? 0;
    tableMap[item.table_id].sessions += 1;
  }
  const topTables = Object.values(tableMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Overview</h1>
          <p className="text-sm text-gray-400 mt-1">
            {now.toLocaleDateString("en-IN", {
              weekday: "long", day: "numeric", month: "long", year: "numeric",
            })}
          </p>
        </div>
        <DashboardRefresh />
      </div>

      {/* ── Location tabs ── */}
      <div className="flex gap-2 flex-wrap">
        <Link
          href="/owner"
          className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
            !selectedLocId
              ? "bg-gray-900 text-white"
              : "bg-white border border-gray-200 text-gray-500 hover:text-gray-900 hover:border-gray-400"
          }`}
        >
          All Locations
        </Link>
        {(allLocations ?? []).map((location) => (
          <Link
            key={location.id}
            href={`/owner?loc=${location.id}`}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
              selectedLocId === location.id
                ? "text-white"
                : "bg-white border border-gray-200 text-gray-500 hover:text-gray-900 hover:border-gray-400"
            }`}
            style={selectedLocId === location.id ? { background: "#D4541A" } : {}}
          >
            {location.name}
          </Link>
        ))}
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Today's Revenue"
          value={formatCurrency(todayRevenue)}
          sub={`${filteredToday.length} orders closed`}
          accent="#D4541A"
          icon={<TrendingUp className="h-5 w-5" style={{ color: "#D4541A" }} />}
          trend={revenueTrend}
        />
        <StatCard
          label="Live Tables Now"
          value={String(liveCount)}
          sub={liveCount === 1 ? "table in session" : "tables in session"}
          accent="#10b981"
          icon={<Zap className="h-5 w-5" style={{ color: "#10b981" }} />}
        />
        <StatCard
          label="Bookings Today"
          value={String(bookingsToday)}
          sub="confirmed & pending check-in"
          accent="#6366f1"
          icon={<Calendar className="h-5 w-5" style={{ color: "#6366f1" }} />}
        />
        <StatCard
          label="Month Revenue"
          value={formatCurrency(monthRevenue)}
          sub={`${filteredMonth.length} orders this month`}
          accent="#f59e0b"
          icon={<Receipt className="h-5 w-5" style={{ color: "#f59e0b" }} />}
          trend={monthTrend}
          trendLabel="vs last month"
        />
      </div>

      {/* ── Chart + Live now ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        <div className="xl:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-sm font-bold text-gray-900">Revenue — last 7 days</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {selectedLocData ? selectedLocData.name : "All locations"} · finalized orders only
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">7-day total</p>
              <p className="text-base font-bold text-gray-900 tabular-nums mt-0.5">
                {formatCurrency(weekTotal)}
              </p>
            </div>
          </div>
          <RevenueChart data={weekData} />
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-bold text-gray-900">Live Now</p>
            <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {liveCount} active
            </span>
          </div>

          {liveCount === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-2xl mb-2">🎱</p>
              <p className="text-sm font-medium text-gray-400">All tables idle</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50 overflow-y-auto" style={{ maxHeight: 240 }}>
              {filteredLiveDetail.map((session) => {
                const order = session.order as { customer_name: string } | null;
                const table = session.table as { name: string; type: string; location_id: string } | null;
                return (
                  <div key={session.id} className="px-5 py-3 flex items-center gap-3">
                    <span className="text-lg shrink-0">{tableIcon(table?.type ?? "")}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 leading-tight truncate">
                        {table?.name ?? "—"}
                      </p>
                      <p className="text-xs text-gray-400 truncate mt-0.5">
                        {order?.customer_name ?? "—"}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-mono font-bold tabular-nums" style={{ color: "#D4541A" }}>
                        {session.actual_start ? elapsed(session.actual_start) : "—"}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">₹{session.rate_per_hour}/hr</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 30-day insights: peak/slow hours + hourly distribution ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        <div className="xl:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-gray-500" /> Hourly activity
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Sessions started per hour · last 30 days
              </p>
            </div>
            <div className="flex gap-4">
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center justify-end gap-1">
                  <Flame className="h-2.5 w-2.5" style={{ color: "#ef4444" }} /> Peak
                </p>
                <p className="text-sm font-bold tabular-nums text-gray-900 mt-0.5">
                  {peakHours.length > 0
                    ? peakHours.map((h) => `${h.hour}:00`).join(" · ")
                    : "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 flex items-center justify-end gap-1">
                  <Snowflake className="h-2.5 w-2.5" style={{ color: "#6366f1" }} /> Slow
                </p>
                <p className="text-sm font-bold tabular-nums text-gray-900 mt-0.5">
                  {slowHours.length > 0
                    ? slowHours.map((h) => `${h.hour}:00`).join(" · ")
                    : "—"}
                </p>
              </div>
            </div>
          </div>
          {!hasHourData ? (
            <div className="py-10 text-center text-sm text-gray-400">
              No session history yet — once tables start running, the busy hours show up here.
            </div>
          ) : (
            <div className="flex items-end gap-1" style={{ height: 110 }}>
              {sessionsByHour.map((b) => {
                const pct = b.count / maxHourCount;
                const h   = Math.max(Math.round(pct * 90), b.count > 0 ? 4 : 0);
                const isPeak = peakHours.some((p) => p.hour === b.hour) && b.count > 0;
                const isSlow = slowHours.some((s) => s.hour === b.hour) && b.count === 0;
                return (
                  <div key={b.hour} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <span className="text-[9px] font-semibold text-gray-400 tabular-nums leading-none">
                      {b.count > 0 ? b.count : ""}
                    </span>
                    <div
                      className="w-full rounded-t-md"
                      style={{
                        height: h,
                        minHeight: b.count > 0 ? 4 : 0,
                        background: isPeak ? "#ef4444" : isSlow ? "#e5e7eb" : "#D4541A",
                      }}
                      title={`${b.hour}:00 — ${b.count} session${b.count === 1 ? "" : "s"}`}
                    />
                    <span className="text-[9px] font-semibold text-gray-400 tabular-nums leading-none">
                      {b.hour}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Most-profitable tables — vertical list on the right of the hour chart */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Crown className="h-4 w-4 text-amber-500" />
            <p className="text-sm font-bold text-gray-900">Most profitable</p>
            <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-gray-400">
              30 days
            </span>
          </div>
          {topTables.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-gray-400">
              No finished sessions yet
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {topTables.map((t, i) => (
                <div key={t.name + i} className="px-5 py-3 flex items-center gap-3">
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0"
                    style={{
                      background: i === 0 ? "rgba(245,158,11,0.15)" : "rgba(0,0,0,0.04)",
                      color:      i === 0 ? "#f59e0b" : "#6b7280",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-lg shrink-0">{tableIcon(t.type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{t.name}</p>
                    <p className="text-[11px] text-gray-400 tabular-nums">
                      {t.sessions} session{t.sessions === 1 ? "" : "s"}
                    </p>
                  </div>
                  <p className="text-sm font-bold tabular-nums text-gray-900 shrink-0">
                    {formatCurrency(t.revenue)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Best selling items ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Package className="h-4 w-4 text-emerald-600" />
          <p className="text-sm font-bold text-gray-900">Best-selling items</p>
          <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-gray-400">
            By revenue · 30 days
          </span>
        </div>
        {topSellers.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400">
            No catalogue sales yet — once staff adds extras to orders, the top sellers appear here.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {topSellers.map((s, i) => {
              const maxRev = topSellers[0].revenue;
              const pct    = (s.revenue / maxRev) * 100;
              return (
                <div key={s.name + i} className="px-6 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0"
                      style={{
                        background: i === 0 ? "rgba(16,185,129,0.12)" : "rgba(0,0,0,0.04)",
                        color:      i === 0 ? "#10b981" : "#6b7280",
                      }}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-gray-900 truncate">{s.name}</p>
                        <p className="text-sm font-bold tabular-nums text-gray-900 shrink-0">
                          {formatCurrency(s.revenue)}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 mt-1">
                        <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, background: "#10b981" }}
                          />
                        </div>
                        <p className="text-[11px] text-gray-400 tabular-nums shrink-0 w-16 text-right">
                          {s.units} sold
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Recent orders ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm font-bold text-gray-900">Recent Orders</p>
          <span className="text-xs text-gray-400">Last 8 finalized</span>
        </div>

        {filteredRecent.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-gray-400">No finalized orders yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filteredRecent.map((order) => {
              const locName = (order.location as { name?: string } | null)?.name ?? "—";
              const when = order.finalized_at
                ? new Date(order.finalized_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                : "—";
              const day = order.finalized_at
                ? new Date(order.finalized_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                : "";
              return (
                <div
                  key={order.id}
                  className="flex items-center justify-between px-6 py-3.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                      style={{ background: order.type === "online" ? "#6366f1" : "#D4541A" }}
                    >
                      {(order.customer_name ?? "?")[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{order.customer_name}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {locName} · {order.type === "online" ? "Online" : "Walk-in"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 shrink-0">
                    <p className="text-xs text-gray-400 tabular-nums">{day} {when}</p>
                    <p className="text-sm font-bold text-gray-900 tabular-nums w-20 text-right">
                      {formatCurrency((order.amount_due ?? 0) + (order.advance_paid ?? 0))}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
