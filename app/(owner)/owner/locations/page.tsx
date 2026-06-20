export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { createAdminClient } from "@/lib/supabase/admin";
import { LocationsContent } from "./content";

export default async function LocationsPage() {
  const admin = createAdminClient();
  const { data: locations } = await admin.from("locations").select("*").order("created_at");
  return <LocationsContent initialLocations={locations ?? []} />;
}
