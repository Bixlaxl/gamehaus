export const runtime = 'edge';

import { createAdminClient } from "@/lib/supabase/admin";
import { ReportsContent } from "./content";

export default async function ReportsPage() {
  const admin = createAdminClient();

  const today = new Date();
  const toDate   = today.toISOString().split("T")[0];
  const fromDate = new Date(Date.now() - 29 * 86400000).toISOString().split("T")[0];

  const { data: locations } = await admin.from("locations").select("*").eq("is_active", true);

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
    .select(`id, customer_name, customer_phone, amount_due, advance_paid, type, finalized_at, location:locations(id, name), items:order_items(status), payments(method, amount, status)`)
    .eq("status", "finalized")
    .gte("finalized_at", fromISO)
    .lte("finalized_at", toISO);

  return (
    <ReportsContent
      initialReportData={{ orders: orders ?? [], locations: locations ?? [] }}
      initialFrom={fromDate}
      initialTo={toDate}
    />
  );
}
