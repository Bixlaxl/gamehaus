export const runtime = "edge";
export const dynamic = 'force-dynamic';

import { createAdminClient } from "@/lib/supabase/admin";
import { MembershipsContent } from "./content";

export default async function MembershipsPage() {
  const admin = createAdminClient();
  const now   = new Date().toISOString();

  const [{ data: plans }, { data: assignments }, { data: tables }] = await Promise.all([
    admin.from("membership_plans").select("*").order("price"),
    admin
      .from("customer_memberships")
      .select(`*, plan:membership_plans(*)`)
      .eq("is_active", true)
      .gte("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("tables")
      .select(`id, name, type, location:locations(name)`)
      .eq("is_active", true)
      .order("name"),
  ]);

  const phones = Array.from(new Set((assignments ?? []).map((a) => a.customer_phone)));
  let profiles: any[] = [];
  if (phones.length > 0) {
    const { data: profs } = await admin
      .from("customer_profiles")
      .select("phone, name")
      .in("phone", phones);
    profiles = profs ?? [];
  }

  const assignmentsWithNames = (assignments ?? []).map((a) => {
    const profile = profiles.find((p) => p.phone === a.customer_phone);
    return {
      ...a,
      customer_name: profile?.name ?? "Unknown",
    };
  });

  return (
    <MembershipsContent
      initialPlans={plans ?? []}
      initialAssignments={assignmentsWithNames as any ?? []}
      tables={tables as any ?? []}
    />
  );
}
