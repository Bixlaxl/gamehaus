export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { createAdminClient } from "@/lib/supabase/admin";
import { ReportsContent } from "./content";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from: spFrom, to: spTo } = await searchParams;
  const admin = createAdminClient();

  const getTodayLocalStr = () => {
    const d = new Date(new Date().getTime() + 5.5 * 3600 * 1000);
    return d.toISOString().split("T")[0];
  };
  const todayStr = getTodayLocalStr();

  const toDate   = spTo || todayStr;
  const fromDate = spFrom || todayStr;

  const { data: locations } = await admin.from("locations").select("*");

  // Determine earliest opening and latest closing across all locations
  let minOpenMins = 600; // default 10:00
  let maxCloseMins = 1380; // default 23:00

  if (locations && locations.length > 0) {
    minOpenMins = Infinity;
    maxCloseMins = -Infinity;
    for (const l of locations) {
      const op = l.opening_time ?? "10:00";
      const cl = l.closing_time ?? "23:00";
      const [oh, om] = op.split(":").map(Number);
      const [ch, cm] = cl.split(":").map(Number);

      const openMins = oh * 60 + om;
      let closeMins = ch * 60 + cm;
      if (closeMins <= openMins) {
        closeMins += 24 * 60;
      }

      if (openMins < minOpenMins) minOpenMins = openMins;
      if (closeMins > maxCloseMins) maxCloseMins = closeMins;
    }
  }

  const earliestOpening = `${String(Math.floor(minOpenMins / 60)).padStart(2, "0")}:${String(minOpenMins % 60).padStart(2, "0")}`;
  
  let latestClosing = "";
  let crossesMidnight = false;
  if (maxCloseMins >= 24 * 60) {
    crossesMidnight = true;
    const norm = maxCloseMins - 24 * 60;
    latestClosing = `${String(Math.floor(norm / 60)).padStart(2, "0")}:${String(norm % 60).padStart(2, "0")}`;
  } else {
    latestClosing = `${String(Math.floor(maxCloseMins / 60)).padStart(2, "0")}:${String(maxCloseMins % 60).padStart(2, "0")}`;
  }

  const fromISO = new Date(fromDate + "T" + earliestOpening + "+05:30").toISOString();
  const toEndDate = crossesMidnight
    ? (() => { const d = new Date(toDate + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().split("T")[0]; })()
    : toDate;
  const toISO = new Date(toEndDate + "T" + latestClosing + "+05:30").toISOString();

  // Paginate fetching of orders
  const orders: any[] = [];
  let ordersPage = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await admin
      .from("orders")
      .select(`id, customer_name, customer_phone, amount_due, advance_paid, subtotal, discount_amount, public_discount_amount, total_amount, points_redeemed, type, created_by, staff:users!orders_created_by_fkey(name), finalized_at, location:locations(id, name), items:order_items(status, rate_per_hour, actual_start, expected_end, final_amount, free_hours_to_redeem), payments(method, amount, status, collected_by, collector:users!payments_collected_by_fkey(name)), extras:order_extras(price, cost_price, quantity, is_deleted)`)
      .eq("status", "finalized")
      .gte("finalized_at", fromISO)
      .lte("finalized_at", toISO)
      .order("finalized_at", { ascending: true })
      .range(ordersPage * pageSize, (ordersPage + 1) * pageSize - 1);
    
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    orders.push(...data);
    if (data.length < pageSize) break;
    ordersPage++;
  }

  // Fetch 6 months history for SSR hydration
  const today = new Date();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(today.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);
  const histFromISO = new Date(sixMonthsAgo.toISOString().split("T")[0] + "T" + earliestOpening + "+05:30").toISOString();

  const history: any[] = [];
  let histPage = 0;
  while (true) {
    const { data, error } = await admin
      .from("orders")
      .select(`id, amount_due, advance_paid, finalized_at, location_id, location:locations(id, name)`)
      .eq("status", "finalized")
      .gte("finalized_at", histFromISO)
      .order("finalized_at", { ascending: true })
      .range(histPage * pageSize, (histPage + 1) * pageSize - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    history.push(...data);
    if (data.length < pageSize) break;
    histPage++;
  }

  // Fetch customer memberships assigned in the last 6 months (matching the history range)
  // Use full-day IST boundaries so created_at (UTC) is captured regardless of business hours
  const membHistFromISO = new Date(sixMonthsAgo.toISOString().split("T")[0] + "T00:00:00+05:30").toISOString();
  const membToISO   = new Date(toDate   + "T23:59:59+05:30").toISOString();

  const memberships: any[] = [];
  let membPage = 0;
  while (true) {
    const { data, error } = await admin
      .from("customer_memberships")
      .select(`id, customer_phone, starts_at, created_at, plan:membership_plans(id, name, price)`)
      .gte("created_at", membHistFromISO)
      .lte("created_at", membToISO)
      .order("created_at", { ascending: true })
      .range(membPage * pageSize, (membPage + 1) * pageSize - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    memberships.push(...data);
    if (data.length < pageSize) break;
    membPage++;
  }

  return (
    <ReportsContent
      initialReportData={{
        orders: orders ?? [],
        locations: locations ?? [],
        history: history ?? [],
        memberships: memberships ?? [],
      }}
      initialFrom={fromDate}
      initialTo={toDate}
    />
  );
}
