export const runtime = 'edge';

import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";
import { DashboardRefresh } from "@/components/owner/dashboard-refresh";
import {
  TrendingUp, Zap, Calendar, Receipt,
  ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, accent, icon, trend,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
  icon: React.ReactNode;
  trend?: number;
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
                {Math.abs(trend)}% vs yesterday
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
  return "🎱";
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
  const sevenDaysAgo  = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  // All queries fetch location_id so we can filter in JS
  const [
    { data: todayOrders },
    { data: yesterdayOrders },
    { data: monthOrders },
    { data: allLiveSessions },
    { data: allTodayBookings },
    { data: allRecentOrders },
    { data: weekOrders },
    { data: allLiveDetail },
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

    // Live sessions — join tables to get location
    admin.from("order_items")
      .select("id, table:tables!inner(location_id)")
      .eq("status", "running"),

    // Bookings — join orders to get location
    admin.from("bookings")
      .select("id, order:orders!inner(location_id)")
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
  ]);

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
  const filteredWeek       = (weekOrders       ?? []).filter(filterLoc);
  const filteredLive       = (allLiveSessions  ?? []).filter(filterTableLoc);
  const filteredBookings   = (allTodayBookings ?? []).filter(filterOrderLoc);
  const filteredRecent     = (allRecentOrders  ?? []).filter(filterLoc).slice(0, 8);
  const filteredLiveDetail = (allLiveDetail    ?? []).filter(filterTableLoc).slice(0, 8);

  const todayRevenue     = filteredToday.reduce((s, o)     => s + orderTotal(o), 0);
  const yesterdayRevenue = filteredYesterday.reduce((s, o) => s + orderTotal(o), 0);
  const monthRevenue     = filteredMonth.reduce((s, o)     => s + orderTotal(o), 0);
  const liveCount        = filteredLive.length;
  const bookingsToday    = filteredBookings.length;

  const revenueTrend =
    yesterdayRevenue > 0
      ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
      : todayRevenue > 0 ? 100 : 0;

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
