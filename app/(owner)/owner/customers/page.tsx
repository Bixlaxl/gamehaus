export const runtime = 'edge';

import { createAdminClient } from "@/lib/supabase/admin";
import { CustomersContent } from "./content";

const PAGE_SIZE = 500;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const admin = createAdminClient();
  const page = Math.max(1, parseInt(searchParams.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;

  const [
    { data: customers, count: totalCount },
    { data: locations },
    { data: locationPhones },
    { data: allStats }
  ] = await Promise.all([
    admin
      .from("customer_profiles")
      .select("id, phone, name, visit_count, total_spent, points_balance, last_visit_at", { count: "exact" })
      .order("last_visit_at", { ascending: false, nullsFirst: false })
      .range(from, to),
    admin
      .from("locations")
      .select("id, name")
      .order("name"),
    // Only fetch distinct phone + location pairs — no full order data
    admin
      .from("orders")
      .select("customer_phone, location_id")
      .not("customer_phone", "is", null)
      .limit(5000),
    admin
      .from("customer_profiles")
      .select("points_balance, total_spent, visit_count")
  ]);

  const totalPages = Math.ceil((totalCount ?? 0) / PAGE_SIZE);

  // Compute global aggregates across all pages
  const statsList = allStats ?? [];
  const statsTotalCustomers = totalCount ?? statsList.length;
  const statsRepeatCustomers = statsList.filter(c => c.visit_count > 1).length;
  const statsTotalPoints = statsList.reduce((s, c) => s + (c.points_balance || 0), 0);
  const statsTotalRevenue = statsList.reduce((s, c) => s + (c.total_spent || 0), 0);

  return (
    <CustomersContent
      initialCustomers={customers ?? []}
      locations={locations ?? []}
      orders={(locationPhones ?? []) as { customer_phone: string; location_id: string }[]}
      page={page}
      totalPages={totalPages}
      totalCount={totalCount ?? 0}
      globalTotalCustomers={statsTotalCustomers}
      globalRepeatCustomers={statsRepeatCustomers}
      globalTotalPoints={statsTotalPoints}
      globalTotalRevenue={statsTotalRevenue}
    />
  );
}
