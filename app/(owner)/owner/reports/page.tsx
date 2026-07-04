export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { createAdminClient } from "@/lib/supabase/admin";
import { ReportsContent } from "./content";

export default async function ReportsPage() {
  const admin = createAdminClient();

  const today = new Date();
  const toDate   = today.toISOString().split("T")[0];
  const fromDate = new Date(Date.now() - 29 * 86400000).toISOString().split("T")[0];

  const { data: locations } = await admin.from("locations").select("*");

  const loc     = locations?.[0];
  const opening = loc?.opening_time ?? "10:00";
  const closing = loc?.closing_time ?? "23:00";
  const [openH]  = opening.split(":").map(Number);
  const [closeH] = closing.split(":").map(Number);
  const crossesMidnight = closeH < openH;

  const fromISO = new Date(fromDate + "T" + opening + "+05:30").toISOString();
  const toEndDate = crossesMidnight
    ? (() => { const d = new Date(toDate + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().split("T")[0]; })()
    : toDate;
  const toISO = new Date(toEndDate + "T" + closing + "+05:30").toISOString();

  const { data: orders } = await admin
    .from("orders")
    .select(`id, customer_name, customer_phone, amount_due, advance_paid, subtotal, discount_amount, public_discount_amount, total_amount, points_redeemed, type, finalized_at, location:locations(id, name), items:order_items(status, rate_per_hour, actual_start, expected_end, final_amount, free_hours_to_redeem), payments(method, amount, status), extras:order_extras(price, cost_price, quantity, is_deleted)`)
    .eq("status", "finalized")
    .gte("finalized_at", fromISO)
    .lte("finalized_at", toISO)
    .limit(50000);

  // Fetch 6 months history for SSR hydration
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(today.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);
  const histFromISO = new Date(sixMonthsAgo.toISOString().split("T")[0] + "T" + opening + "+05:30").toISOString();

  const { data: history } = await admin
    .from("orders")
    .select(`id, amount_due, advance_paid, finalized_at, location_id, location:locations(id, name)`)
    .eq("status", "finalized")
    .gte("finalized_at", histFromISO)
    .order("finalized_at", { ascending: true })
    .limit(50000);

  // Fetch customer memberships assigned in the last 6 months (matching the history range)
  // Use full-day IST boundaries so created_at (UTC) is captured regardless of business hours
  const membHistFromISO = new Date(sixMonthsAgo.toISOString().split("T")[0] + "T00:00:00+05:30").toISOString();
  const membToISO   = new Date(toDate   + "T23:59:59+05:30").toISOString();

  const { data: memberships } = await admin
    .from("customer_memberships")
    .select(`id, customer_phone, starts_at, created_at, plan:membership_plans(id, name, price)`)
    .gte("created_at", membHistFromISO)
    .lte("created_at", membToISO)
    .limit(50000);

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
