export const runtime = 'edge';

import { createAdminClient } from "@/lib/supabase/admin";
import { CustomersContent } from "./content";

const PAGE_SIZE = 500;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: {
    page?: string;
    q?: string;
    sortBy?: string;
    minVisits?: string;
    minPoints?: string;
    location?: string;
  };
}) {
  const admin = createAdminClient();
  const page = Math.max(1, parseInt(searchParams.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to   = from + PAGE_SIZE - 1;

  const q = searchParams.q?.trim() || "";
  const sortBy = searchParams.sortBy || "last_visit";
  const minVisits = searchParams.minVisits || "";
  const minPoints = searchParams.minPoints || "";
  const location = searchParams.location || "all";

  // Build the main query
  let query = admin
    .from("customer_profiles")
    .select("id, phone, name, visit_count, total_spent, points_balance, last_visit_at", { count: "exact" });

  // Apply location filter if specified
  if (location !== "all") {
    // Fetch unique phones for this location from orders
    const { data: locOrders } = await admin
      .from("orders")
      .select("customer_phone")
      .eq("location_id", location)
      .not("customer_phone", "is", null);
    
    const uniquePhones = Array.from(
      new Set((locOrders ?? []).map((o) => o.customer_phone).filter(Boolean))
    );

    if (uniquePhones.length > 0) {
      query = query.in("phone", uniquePhones);
    } else {
      // Dummy query to return no results
      query = query.in("phone", ["0000000000"]);
    }
  }

  // Apply search text
  if (q) {
    query = query.or(`name.ilike.%${q}%,phone.like.%${q}%`);
  }

  // Apply numeric filters
  if (minVisits) {
    const visits = parseInt(minVisits);
    if (!isNaN(visits)) {
      query = query.gte("visit_count", visits);
    }
  }
  if (minPoints) {
    const points = parseInt(minPoints);
    if (!isNaN(points)) {
      query = query.gte("points_balance", points);
    }
  }

  // Apply sorting
  if (sortBy === "total_spent") {
    query = query.order("total_spent", { ascending: false });
  } else if (sortBy === "visit_count") {
    query = query.order("visit_count", { ascending: false });
  } else if (sortBy === "points_balance") {
    query = query.order("points_balance", { ascending: false });
  } else {
    query = query.order("last_visit_at", { ascending: false, nullsFirst: false });
  }

  // Apply range
  query = query.range(from, to);

  const [
    { data: customers, count: totalCount },
    { data: locations },
    { data: allStats }
  ] = await Promise.all([
    query,
    admin
      .from("locations")
      .select("id, name")
      .order("name"),
    admin
      .from("customer_profiles")
      .select("points_balance, total_spent, visit_count")
  ]);

  const totalPages = Math.ceil((totalCount ?? 0) / PAGE_SIZE);

  // Compute global aggregates across all pages (unfiltered base)
  const statsList = allStats ?? [];
  const statsTotalCustomers = statsList.length;
  const statsRepeatCustomers = statsList.filter(c => c.visit_count > 1).length;
  const statsTotalPoints = statsList.reduce((s, c) => s + (c.points_balance || 0), 0);
  const statsTotalRevenue = statsList.reduce((s, c) => s + (c.total_spent || 0), 0);

  return (
    <CustomersContent
      initialCustomers={customers ?? []}
      locations={locations ?? []}
      page={page}
      totalPages={totalPages}
      totalCount={totalCount ?? 0}
      globalTotalCustomers={statsTotalCustomers}
      globalRepeatCustomers={statsRepeatCustomers}
      globalTotalPoints={statsTotalPoints}
      globalTotalRevenue={statsTotalRevenue}
      currentQ={q}
      currentSortBy={sortBy}
      currentMinVisits={minVisits}
      currentMinPoints={minPoints}
      currentLocation={location}
    />
  );
}
