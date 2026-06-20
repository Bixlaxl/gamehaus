export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { createAdminClient } from "@/lib/supabase/admin";
import { StaffContent } from "./content";
import type { Location } from "@/lib/supabase/types";

export default async function StaffPage() {
  const admin = createAdminClient();
  const [{ data: locations }, { data: staff }] = await Promise.all([
    admin.from("locations").select("*").eq("is_active", true),
    admin.from("users").select("*, locations(name)").eq("role", "staff").order("created_at", { ascending: false }),
  ]);
  return <StaffContent initialLocations={(locations ?? []) as Location[]} initialStaff={staff ?? []} />;
}
