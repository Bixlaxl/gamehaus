export const runtime = 'edge';

import { createAdminClient } from "@/lib/supabase/admin";
import { CustomersContent } from "./content";

export default async function CustomersPage() {
  const admin = createAdminClient();

  const [{ data: customers }, { data: locations }, { data: orders }] = await Promise.all([
    admin
      .from("customer_profiles")
      .select("id, phone, name, visit_count, total_spent, points_balance, last_visit_at")
      .order("last_visit_at", { ascending: false }),
    admin
      .from("locations")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    admin
      .from("orders")
      .select("customer_phone, location_id")
      .not("customer_phone", "is", null),
  ]);

  return (
    <CustomersContent
      initialCustomers={customers ?? []}
      locations={locations ?? []}
      orders={(orders ?? []) as { customer_phone: string; location_id: string }[]}
    />
  );
}
