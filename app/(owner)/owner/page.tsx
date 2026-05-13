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
  trend?: number; // % vs yesterday — positive = up, negative = down
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

// ── 7-day bar chart (pure CSS, no external library) ────────────────────────────
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function RevenueChart({ data }: { data: { date: Date; revenue: number }[] }) {
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const BAR_MAX_H = 96; // px

  return (
    <div className="flex items-stretch gap-1.5" style={{ height: 140 }}>
      {data.map((d, i) => {
        const barH = d.revenue > 0
          ? Math.max(Math.round((d.revenue / max) * BAR_MAX_H), 5)
          : 0;
        const isToday = i === data.length - 1;
        const label   = isToday ? "Today" : DAY_ABBR[d.date.getDay()];

        return (
          <div
            key={i}
            className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
          >
            {/* amount label — only when bar is visible */}
            {d.revenue > 0 && (
              <span className="text-[9px] font-semibold text-gray-400 tabular-nums leading-none">
                {d.revenue >= 1000
                  ? `${(d.revenue / 1000).toFixed(1)}k`
                  : Math.round(d.revenue).toString()}
              </span>
            )}

            {/* bar */}
            <div
              className="w-full rounded-t-md"
              style={{
                height: barH,
                background: isToday ? "#D4541A" : "#F0ECE7",
                minHeight: barH > 0 ? 4 : 0,
              }}
            />

            {/* day label */}
            <span
              className={`text-[10px] font-semibold ${
                isToday ? "text-gray-800" : "text-gray-400"
              }`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Table type icon ────────────────────────────────────────────────────────────
function tableIcon(type: string) {
  if (type === "ps5")      return "🎮";
  if (type === "foosball") return "⚽";
  return "🎱";
}

// ── Elapsed helper (server-side snapshot) ────────────────────────────────────
function elapsed(start: string): string {
  const totalMins = Math.floor((Date.now() - new Date(start).getTime()) / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default async function OwnerDashboard() {
  const admin = createAdminClient();

  const now            = new Date();
  const todayStart     = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const monthStart     = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const sevenDaysAgo   = new Date(todayStart); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const [
    { data: todayOrders },
    { data: yesterdayOrders },
    { data: monthOrders },
    { data: liveSessions },
    { data: todayBookings },
    { data: recentOrders },
    { data: weekOrders },
    { data: liveDetail },
  ] = await Promise.all([
    admin.from("orders").select("amount_due")
      .eq("status", "finalized").gte("finalized_at", todayStart.toISOString()),

    admin.from("orders").select("amount_due")
      .eq("status", "finalized")
      .gte("finalized_at", yesterdayStart.toISOString())
      .lt("finalized_at", todayStart.toISOString()),

    admin.from("orders").select("amount_due")
      .eq("status", "finalized").gte("finalized_at", monthStart.toISOString()),

    admin.from("order_items").select("id").eq("status", "running"),

    admin.from("bookings").select("id")
      .eq("status", "confirmed").gte("scheduled_start", todayStart.toISOString()),

    admin.from("orders")
      .select("id, customer_name, customer_phone, amount_due, type, finalized_at, location:locations(name)")
      .eq("status", "finalized")
      .order("finalized_at", { ascending: false })
      .limit(8),

    admin.from("orders").select("amount_due, finalized_at")
      .eq("status", "finalized").gte("finalized_at", sevenDaysAgo.toISOString()),

    admin.from("order_items")
      .select("id, actual_start, rate_per_hour, order:orders(customer_name), table:tables(name, type)")
      .eq("status", "running")
      .order("actual_start", { ascending: true })
      .limit(8),
  ]);

  // ── Compute scalars ──────────────────────────────────────────────────────────
  const todayRevenue     = (todayOrders     ?? []).reduce((s, o) => s + (o.amount_due ?? 0), 0);
  const yesterdayRevenue = (yesterdayOrders ?? []).reduce((s, o) => s + (o.amount_due ?? 0), 0);
  const monthRevenue     = (monthOrders     ?? []).reduce((s, o) => s + (o.amount_due ?? 0), 0);
  const liveCount        = liveSessions?.length ?? 0;
  const bookingsToday    = todayBookings?.length ?? 0;

  const revenueTrend =
    yesterdayRevenue > 0
      ? Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100)
      : todayRevenue > 0 ? 100 : 0;

  // ── Build 7-day chart data ───────────────────────────────────────────────────
  const weekData: { date: Date; revenue: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(todayStart); dayStart.setDate(dayStart.getDate() - i);
    const dayEnd   = new Date(dayStart);   dayEnd.setDate(dayEnd.getDate() + 1);
    const revenue  = (weekOrders ?? [])
      .filter((o) => {
        const t = new Date(o.finalized_at!);
        return t >= dayStart && t < dayEnd;
      })
      .reduce((s, o) => s + (o.amount_due ?? 0), 0);
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

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Today's Revenue"
          value={formatCurrency(todayRevenue)}
          sub={`${todayOrders?.length ?? 0} orders closed`}
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
          sub={`${monthOrders?.length ?? 0} orders this month`}
          accent="#f59e0b"
          icon={<Receipt className="h-5 w-5" style={{ color: "#f59e0b" }} />}
        />
      </div>

      {/* ── Chart + Live now ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* 7-day revenue chart */}
        <div className="xl:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <p className="text-sm font-bold text-gray-900">Revenue — last 7 days</p>
              <p className="text-xs text-gray-400 mt-0.5">Finalized orders only</p>
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

        {/* Live sessions */}
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
              {(liveDetail ?? []).map((session) => {
                const order = session.order as { customer_name: string } | null;
                const table = session.table as { name: string; type: string } | null;
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
                      <p
                        className="text-xs font-mono font-bold tabular-nums"
                        style={{ color: "#D4541A" }}
                      >
                        {session.actual_start ? elapsed(session.actual_start) : "—"}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        ₹{session.rate_per_hour}/hr
                      </p>
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

        {(recentOrders ?? []).length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-gray-400">No finalized orders yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {(recentOrders ?? []).map((order) => {
              const loc  = order.location as { name?: string } | null;
              const when = order.finalized_at
                ? new Date(order.finalized_at).toLocaleTimeString("en-IN", {
                    hour: "2-digit", minute: "2-digit",
                  })
                : "—";
              const day = order.finalized_at
                ? new Date(order.finalized_at).toLocaleDateString("en-IN", {
                    day: "numeric", month: "short",
                  })
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
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {order.customer_name}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {loc?.name ?? "—"} · {order.type === "online" ? "Online" : "Walk-in"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 shrink-0">
                    <p className="text-xs text-gray-400 tabular-nums">{day} {when}</p>
                    <p className="text-sm font-bold text-gray-900 tabular-nums w-20 text-right">
                      {formatCurrency(order.amount_due ?? 0)}
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
