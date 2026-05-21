export const runtime = "edge";

import { createAdminClient } from "@/lib/supabase/admin";
import { MembershipsContent } from "./content";

export default async function MembershipsPage() {
  const admin = createAdminClient();
  const now   = new Date().toISOString();

  const [{ data: plans }, { data: assignments }] = await Promise.all([
    admin.from("membership_plans").select("*").order("price"),
    admin
      .from("customer_memberships")
      .select(`*, plan:membership_plans(name, discount_pct, free_hrs)`)
      .eq("is_active", true)
      .gte("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <MembershipsContent
      initialPlans={plans ?? []}
      initialAssignments={assignments ?? []}
    />
  );
}
