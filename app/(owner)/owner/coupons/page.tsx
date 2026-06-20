export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { createAdminClient } from "@/lib/supabase/admin";
import { CouponsContent } from "./content";

export default async function CouponsPage() {
  const admin = createAdminClient();
  const [{ data: locations }, { data: coupons }] = await Promise.all([
    admin.from("locations").select("*").eq("is_active", true),
    admin.from("coupons").select("*, location:locations(name)").order("created_at", { ascending: false }),
  ]);
  return <CouponsContent initialLocations={locations ?? []} initialCoupons={coupons ?? []} />;
}
