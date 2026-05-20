export const runtime = 'edge';

import { createAdminClient } from "@/lib/supabase/admin";
import { LocationsContent } from "./content";

export default async function LocationsPage() {
  const admin = createAdminClient();
  const { data: locations } = await admin.from("locations").select("*").order("created_at");
  return <LocationsContent initialLocations={locations ?? []} />;
}
